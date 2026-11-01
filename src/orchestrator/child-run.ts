// Fork-per-run execution for serve mode (ADR 0017).
//
// The orchestrator never calls runPlaybook in-process. Instead it materializes a
// temporary playbook/inventory pair, forks the one-shot CLI with `-o jsonl`, and
// parses the typed event/result stream. Each child gets fresh resolver, facts,
// module, and search state, so concurrent runs cannot cross-contaminate; a bad
// plugin dies with its child and cancellation is a SIGTERM away.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { dump as yamlDump } from "js-yaml";

import { loadInventoryFile, loadPlaybookFile, resolveDirectoryVars } from "../config/loader";
import { FsProjectSource } from "../vfs/fs-project-source";
import { resolveTargets } from "../inventory/engine";
import type {
  NormalizedInventory,
  NormalizedPlaybook,
  NormalizedTask,
} from "../config/schema";
import type { HostOutcome, JobBody, PlanTask, TargetDescriptor } from "./types";

/** A child-run result plus the live events observed on its jsonl stream. */
export interface ChildRunResult {
  outcomes: HostOutcome[];
  events: ChildEvent[];
  exitCode: number;
  stderr: string;
}

/** One per-task event emitted by the child before the final result. */
export interface ChildEvent {
  ts: string;
  host: string;
  task: string;
  module: string;
  status: "ok" | "changed" | "failed" | "skipped";
  msg?: string;
}

interface MaterializedRun {
  playbookPath: string;
  inventoryPath: string;
  cleanup: () => void;
}

/**
 * Resolve the command used to fork the CLI. Priority:
 *   1. `opts.childCli` / `ROLECALL_SERVE_CLI` (space-separated) for embedding/tests.
 *   2. `[process.execPath, process.argv[1]]` when argv[1] is a real file.
 *   3. Source checkout under Bun test: `<repo>/src/cli/index.ts`.
 *   4. `[process.execPath]` for compiled binaries.
 */
export function resolveChildCommand(override?: string[]): string[] {
  if (override && override.length > 0) return override;
  const env = process.env["ROLECALL_SERVE_CLI"];
  if (env && env.trim()) return env.trim().split(/\s+/);

  const argv1 = process.argv[1];
  if (argv1 && (/(^|[\\/])src[\\/]cli[\\/]index\.ts$/.test(argv1) || argv1.endsWith("lib/cli.js"))) {
    return [process.execPath, argv1];
  }

  // Source checkout / tests: run the TypeScript entrypoint under Bun. Guard on
  // the runtime binary so a compiled standalone binary never treats the source
  // path as a command-line argument.
  const sourceCli = resolve(import.meta.dir, "../../src/cli/index.ts");
  const runtime = process.execPath.split(/[\\/]/).pop() ?? "";
  if (process.versions.bun && runtime.startsWith("bun") && existsSync(sourceCli)) {
    return [process.execPath, sourceCli];
  }

  // npm channel (`node .../lib/cli.js`) and the source-checkout bin shim.
  if (argv1 && existsSync(argv1) && !/\.test\.[cm]?ts$/.test(argv1)) {
    return [process.execPath, argv1];
  }

  // Compiled standalone binary: it is its own entrypoint.
  return [process.execPath];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Host vars that let a forked CLI reach a server fleet target. */
export function fleetHostVars(desc: TargetDescriptor): Record<string, unknown> {
  const vars: Record<string, unknown> = {};
  switch (desc.kind) {
    case "ssh":
      vars["rolecall_connection"] = "ssh";
      if (desc.host) vars["rolecall_host"] = desc.host;
      if (desc.user) vars["rolecall_user"] = desc.user;
      if (desc.port !== undefined) vars["rolecall_port"] = desc.port;
      if (desc.credentials?.privateKey) vars["rolecall_ssh_private_key"] = desc.credentials.privateKey;
      if (desc.credentials?.password) vars["rolecall_ssh_pass"] = desc.credentials.password;
      break;
    case "local":
      vars["rolecall_connection"] = "local";
      if (desc.host) vars["rolecall_host"] = desc.host;
      if (desc.user) vars["rolecall_user"] = desc.user;
      break;
    case "http":
      vars["rolecall_connection"] = "http";
      if (desc.url) vars["rolecall_http_url"] = desc.url;
      if (desc.auth?.type === "basic") {
        if (desc.auth.user) vars["rolecall_http_user"] = desc.auth.user;
        if (desc.auth.pass) vars["rolecall_http_pass"] = desc.auth.pass;
      } else if (desc.auth?.type === "token" && desc.auth.token) {
        vars["rolecall_http_token"] = desc.auth.token;
      }
      break;
    case "network":
      vars["rolecall_connection"] = "network_sim";
      if (desc.device?.url) vars["rolecall_sim_url"] = desc.device.url;
      if (desc.user) vars["rolecall_user"] = desc.user;
      break;
  }
  return vars;
}

async function normalizePlaybooks(body: JobBody): Promise<{
  playbooks: NormalizedPlaybook[] | null;
  playbookPath: string;
}> {
  const explicitTargets = body.limit !== undefined || (body.targets ?? body.hosts) !== undefined;
  if (body.playbookPath) {
    if (!explicitTargets) return { playbooks: null, playbookPath: body.playbookPath };
    // Explicit targets flatten the inventory into `all`; rewrite play hosts so
    // the playbook still selects the narrowed host set.
    const loaded = await loadPlaybookFile(body.playbookPath);
    return { playbooks: loaded.map((p) => ({ ...p, hosts: ["all"] })), playbookPath: "" };
  }
  if (body.playbook) {
    const playbooks = Array.isArray(body.playbook) ? body.playbook : [body.playbook];
    return {
      playbooks: explicitTargets ? playbooks.map((p) => ({ ...p, hosts: ["all"] })) : playbooks,
      playbookPath: "",
    };
  }
  const tasks: PlanTask[] = body.tasks && body.tasks.length > 0
    ? body.tasks
    : [synthesizeTask(body)];
  return {
    playbooks: [{
      hosts: ["all"],
      vars: {},
      tasks: tasks.map((t): NormalizedTask => ({
        name: t.name,
        ...(t.module ? { module: t.module } : {}),
        args: t.args ?? {},
        notify: [],
      })),
    }],
    playbookPath: "",
  };
}

function synthesizeTask(body: JobBody): PlanTask {
  const args = { ...(body.args ?? {}) };
  // HTTP jobs use the http module rather than treating the route as a shell
  // command. The URL comes from the per-host rolecall_http_url injected by the
  // inventory materializer, so one task fans out across HTTP targets.
  const route = typeof args["route"] === "string" ? args["route"].trim() : "";
  if (route) {
    const [rawMethod = "GET", rawPath = "/"] = route.split(/\s+/);
    const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
    const payload = args["payload"];
    const httpArgs: Record<string, unknown> = {
      url: { $concat: [{ $var: "vars.rolecall_http_url" }, path] },
      method: rawMethod.toUpperCase(),
      return_content: true,
      ...(payload !== undefined ? { body: payload, json: true } : {}),
    };
    for (const [k, v] of Object.entries(args)) {
      if (k !== "route" && k !== "payload") httpArgs[k] = v;
    }
    return { name: `${body.type}:http`, module: "http", args: httpArgs };
  }
  if (body.config !== undefined) {
    return { name: `${body.type}:set_config`, module: "set_config", args: { config: body.config, ...args } };
  }
  if (body.module) {
    const module = body.module === "facts" || body.module === "check" ? "ping" : body.module;
    return { name: `${body.type}:${module}`, module, args };
  }
  if (typeof args["command"] === "string") {
    return { name: `${body.type}:command`, module: "command", args };
  }
  if (typeof args["message"] === "string") {
    return { name: `${body.type}:debug`, module: "debug", args };
  }
  return { name: `${body.type}:ping`, module: "ping", args };
}

function cloneInventory(inv: NormalizedInventory): NormalizedInventory {
  return {
    groups: Object.fromEntries(
      Object.entries(inv.groups).map(([name, g]) => [
        name,
        {
          hosts: [...g.hosts],
          vars: { ...g.vars },
          ...(g.children ? { children: [...g.children] } : {}),
        },
      ]),
    ),
    ...(inv.hostVars ? { hostVars: Object.fromEntries(Object.entries(inv.hostVars).map(([h, v]) => [h, { ...v }])) } : {}),
  };
}

function allHostNames(inv: NormalizedInventory): string[] {
  const out = new Set<string>();
  for (const g of Object.values(inv.groups)) for (const h of g.hosts) out.add(h);
  for (const h of Object.keys(inv.hostVars ?? {})) out.add(h);
  return [...out].sort();
}

/** Keep only hosts selected by explicit target patterns, flattening to ``all``. */
function filterInventory(patterns: string[], resolvedVars: Record<string, Record<string, unknown>>): NormalizedInventory {
  return {
    groups: { all: { hosts: [...patterns].sort(), vars: {} } },
    hostVars: Object.fromEntries(patterns.map((h) => [h, { ...(resolvedVars[h] ?? {}) }])),
  };
}

async function buildInventory(body: JobBody, fleet: Map<string, TargetDescriptor>): Promise<NormalizedInventory> {
  let inv: NormalizedInventory;
  if (body.inventory) {
    inv = cloneInventory(body.inventory);
  } else if (body.inventoryPath) {
    const source = new FsProjectSource(dirname(body.inventoryPath));
    inv = cloneInventory(await loadInventoryFile(body.inventoryPath, source));
    const dirVars = await resolveDirectoryVars(body.inventoryPath, source);
    for (const [group, vars] of Object.entries(dirVars.groupVarsByGroup)) {
      const g = inv.groups[group];
      if (g) g.vars = { ...g.vars, ...vars };
    }
    if (!inv.hostVars) inv.hostVars = {};
    for (const [host, vars] of Object.entries(dirVars.hostVarsByHost)) {
      inv.hostVars[host] = { ...(inv.hostVars[host] ?? {}), ...vars };
    }
  } else {
    inv = {
      groups: { all: { hosts: [...fleet.keys()].sort(), vars: {} } },
      hostVars: {},
    };
  }

  // Explicit target selection narrows the inventory to the resolved hosts. This
  // mirrors the old engine's targets/hosts precedence (and keeps group vars by
  // flattening the already-resolved per-host var maps).
  const selected = body.limit ? [body.limit] : (body.targets ?? body.hosts);
  if (selected && selected.length > 0) {
    const resolved = await resolveTargets(inv, selected, {});
    inv = filterInventory(resolved.matchedHosts, resolved.hosts);
  }

  if (!inv.hostVars) inv.hostVars = {};
  for (const host of allHostNames(inv)) {
    const desc = fleet.get(host);
    if (desc) inv.hostVars[host] = { ...(inv.hostVars[host] ?? {}), ...fleetHostVars(desc) };
  }
  return inv;
}

/** Materialize a temp playbook/inventory pair for a child run. */
export async function materializeChildRun(body: JobBody, fleet: Map<string, TargetDescriptor>): Promise<MaterializedRun> {
  const dir = mkdtempSync(join(tmpdir(), "rolecall-child-"));
  const cleanup = (): void => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch { /* best-effort */ }
  };
  try {
    const { playbooks, playbookPath } = await normalizePlaybooks(body);
    let childPlaybookPath = playbookPath;
    if (playbooks) {
      childPlaybookPath = join(dir, "playbook.yaml");
      writeFileSync(childPlaybookPath, yamlDump(playbooks, { noRefs: true, lineWidth: -1 }), { mode: 0o600 });
    }
    const inventory = await buildInventory(body, fleet);
    const inventoryPath = join(dir, "inventory.yaml");
    writeFileSync(
      inventoryPath,
      yamlDump(
        {
          groups: Object.fromEntries(Object.entries(inventory.groups).map(([name, g]) => [
            name,
            { hosts: g.hosts, ...(g.vars && Object.keys(g.vars).length > 0 ? { vars: g.vars } : {}), ...(g.children ? { children: g.children } : {}) },
          ])),
          ...(inventory.hostVars && Object.keys(inventory.hostVars).length > 0 ? { host_vars: inventory.hostVars } : {}),
        },
        { noRefs: true, lineWidth: -1 },
      ),
      { mode: 0o600 },
    );
    return { playbookPath: childPlaybookPath, inventoryPath, cleanup };
  } catch (err) {
    cleanup();
    throw err;
  }
}

/** Build the child argv for a materialized run. */
export function childArgs(body: JobBody, materialized: { playbookPath: string; inventoryPath: string }): string[] {
  const args = ["playbook", "run", materialized.playbookPath, "--inventory", materialized.inventoryPath, "-o", "jsonl"];
  // body.limit is applied while materializing the inventory (it overrides
  // targets/hosts, mirroring the previous engine), so it is not passed through.
  if (body.force) args.push("--force");
  if (body.check) args.push("--check");
  if (body.diff) args.push("--diff");
  return args;
}

/** Fork the CLI for one job and parse its jsonl event/result stream. */
export function runChild(
  command: string[],
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<ChildRunResult> {
  return new Promise((resolvePromise) => {
    const [cmd, ...prefix] = command;
    if (!cmd) {
      resolvePromise({ outcomes: [], events: [], exitCode: 1, stderr: "no child CLI command configured" });
      return;
    }
    const child = spawn(cmd, [...prefix, ...args], {
      cwd: opts.cwd ?? process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const events: ChildEvent[] = [];
    let outcomes: HostOutcome[] | null = null;
    let stdoutBuf = "";
    let stderrBuf = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        try { child.kill("SIGTERM"); } catch { /* already exited */ }
      }, opts.timeoutMs);
      const t = timer as unknown as { unref?: () => void };
      if (typeof t.unref === "function") t.unref();
    }

    const handleLine = (line: string): void => {
      const text = line.trim();
      if (!text.startsWith("{")) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return;
      }
      if (!isRecord(parsed)) return;
      if (parsed["type"] === "event") {
        const e = parsed as Record<string, unknown>;
        if (typeof e["host"] === "string" && typeof e["task"] === "string" && typeof e["status"] === "string") {
          events.push({
            ts: typeof e["ts"] === "string" ? e["ts"] : new Date().toISOString(),
            host: e["host"],
            task: e["task"],
            module: typeof e["module"] === "string" ? e["module"] : "",
            status: e["status"] as ChildEvent["status"],
            ...(typeof e["msg"] === "string" ? { msg: e["msg"] } : {}),
          });
        }
        return;
      }
      if (parsed["type"] === "result" && isRecord(parsed["result"])) {
        const result = parsed["result"] as Record<string, unknown>;
        const rawOutcomes = Array.isArray(result["outcomes"]) ? result["outcomes"] : [];
        outcomes = rawOutcomes.flatMap((o): HostOutcome[] => {
          if (!isRecord(o) || typeof o["host"] !== "string") return [];
          const failed = o["failed"] === true;
          const changed = o["changed"] === true;
          const skipped = o["skipped"] === true;
          const module = typeof o["module"] === "string" ? o["module"] : "";
          const task = typeof o["task"] === "string" ? o["task"] : "";
          const msg = typeof o["msg"] === "string" ? o["msg"] : undefined;
          const iterationData = Array.isArray(o["iterationData"]) ? o["iterationData"] : [];
          const first = iterationData.find((d) => isRecord(d));
          let response: unknown;
          if (isRecord(first) && typeof first["content"] === "string") {
            try {
              response = JSON.parse(first["content"]);
            } catch {
              response = first["content"];
            }
          }
          return [{
            host: o["host"],
            ok: !failed,
            changed,
            summary: `${task || module}: ${msg ?? (failed ? "failed" : changed ? "changed" : skipped ? "skipped" : "ok")}`,
            task,
            module,
            detail: {
              ...(isRecord(first) ? first : {}),
              ...(response !== undefined ? { response } : {}),
              task,
              module,
              skipped,
              iterations: o["iterations"],
              iterationData: o["iterationData"],
            },
          }];
        });
      }
    };

    child.stdout?.setEncoding("utf-8");
    child.stdout?.on("data", (chunk: string) => {
      stdoutBuf += chunk;
      for (;;) {
        const nl = stdoutBuf.indexOf("\n");
        if (nl === -1) break;
        const line = stdoutBuf.slice(0, nl);
        stdoutBuf = stdoutBuf.slice(nl + 1);
        handleLine(line);
      }
    });
    child.stderr?.setEncoding("utf-8");
    child.stderr?.on("data", (chunk: string) => {
      if (stderrBuf.length < 16_384) stderrBuf += chunk;
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolvePromise({ outcomes: outcomes ?? [], events, exitCode: 1, stderr: `${stderrBuf}${err.message}`.slice(0, 16_384) });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (stdoutBuf.trim()) handleLine(stdoutBuf);
      const exitCode = code ?? 1;
      const fallback: HostOutcome[] = outcomes && outcomes.length > 0
        ? outcomes
        : [];
      resolvePromise({
        outcomes: !outcomes && exitCode !== 0
          ? [{ host: "", ok: false, changed: false, summary: "child run failed", detail: stderrBuf.trim() || `exit ${exitCode}` }]
          : fallback,
        events,
        exitCode,
        stderr: stderrBuf.slice(0, 16_384),
      });
    });
  });
}

