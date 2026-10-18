// Orchestrator execution engine (Task 18).
//
// Owns the fleet registry and the durable-ish RunRecords map, and DISPATCHES jobs
// against reachable targets using REAL transport clients (SshConnection /
// LocalConnection) or real HTTP round-trips (global fetch) — never faked. The
// network kind drives the Task-17 in-process device simulator's programmatic
// apply/diff surface, which shares src/transport/diff logic.
//
// Target resolution reuses upstream loaders + inventory engine verbatim:
//   - playbook/inventory YAML files are parsed by src/config/loader (loadPlaybookFile
//     / loadInventoryFile); patterns resolve through src/inventory/engine.resolveTargets.
//   - inline playbook/tasks/inventory in the job body skip file IO entirely.
//
// Concurrency note (dbt #14550 lesson): records are inserted into the map
// SYNCHRONOUSLY before returning, and every later mutation only SETS fields (never
// check-then-set), so concurrent dispatches cannot race within the single-threaded
// event loop. In-flight promises are tracked only to bound graceful drain.

import { randomUUID } from "node:crypto";

import { loadInventoryFile, loadPlaybookFile, resolveDirectoryVars, type DirectoryVars } from "../config/loader";
import { resolveTargets } from "../inventory/engine";
import { FsProjectSource } from "../vfs/fs-project-source";
import { dirname } from "node:path";
import { SshConnection } from "../transport/ssh";
import { LocalConnection } from "../transport/local";
import type { RetryConfig } from "../transport/connection";
import type { Store } from "../store";
import type { NetworkDeviceSimHandle } from "../testing/sims/network-device";
import type { ApplyOpts } from "../testing/sims/network-device";
import type { JobBody, PlanTask, RunRecord, SchedulerApi, ServerOptions, TargetDescriptor } from "./types";

type Outcome = import("./types").HostOutcome;

const NO_RETRY: Partial<RetryConfig> = { retries: 0, minTimeout: 10, maxTimeout: 20, factor: 2, randomize: false };

export class Engine {
  readonly #fleet = new Map<string, TargetDescriptor>();
  readonly #runs = new Map<string, RunRecord>();
  readonly #inflight = new Set<Promise<void>>();
  readonly #store?: Store;
  readonly #scheduler?: SchedulerApi;
  #draining = false;

  constructor(store?: Store, fleet?: TargetDescriptor[], scheduler?: SchedulerApi, _opts?: ServerOptions) {
    this.#store = store;
    this.#scheduler = scheduler;
    if (fleet) this.registerFleet(fleet);
  }

  /** Drain flag: once true, new runs are rejected (set during graceful shutdown). */
  setDraining(v: boolean): void { this.#draining = v; }
  isDraining(): boolean { return this.#draining; }

  registerFleet(targets: TargetDescriptor[]): void {
    for (const t of targets) this.#fleet.set(t.name, t);
  }

  /** Number of runs currently executing (for status/drain bookkeeping). */
  active(): number {
    return this.#inflight.size;
  }

  get(id: string): RunRecord | undefined {
    return this.#runs.get(id);
  }

  list(): RunRecord[] {
    return [...this.#runs.values()];
  }

  // --- enqueue --------------------------------------------------------------

  enqueue(body: JobBody): string {
    if (this.#draining) throw new Error("server is draining — accepting no new runs");
    if (body.type !== "playbook" && body.type !== "adhoc" && body.type !== "nonIdempotent") {
      throw new Error(`invalid job type '${String(body.type)}'`);
    }
    const id = randomUUID();
    const rec: RunRecord = { id, jobType: body.type, status: "queued", startedAt: Date.now(), outcomes: [], dispatchCount: 0 };
    // Insert synchronously BEFORE awaiting -> poll sees 'queued' immediately.
    this.#runs.set(id, rec);
    this.#persistStart(rec, body);
    const task = this.#dispatch(body, rec);
    this.#inflight.add(task);
    task.finally(() => this.#inflight.delete(task));
    return id;
  }

  async #dispatch(body: JobBody, rec: RunRecord): Promise<void> {
    rec.status = "running";
    this.#persistStatus(rec, "running");
    try {
      const { descriptors, plan } = await this.#plan(body);
      const outcomes: Outcome[] = [];
      let failed = false;
      for (const task of plan) {
        for (const desc of descriptors) {
          const outcome = await this.#executeOne(desc, task, body, rec.id);
          outcomes.push(outcome);
          if (!outcome.ok) failed = true;
        }
        // non-idempotent applies EVERY task regardless of earlier failures.
        if (failed && body.type !== "nonIdempotent") break;
      }
      const ok = outcomes.every((o) => o.ok);
      rec.outcomes = outcomes;
      rec.dispatchCount = outcomes.length;
      rec.status = ok ? "success" : "failed";
      rec.error = ok ? undefined : `${outcomes.filter((o) => !o.ok).length} failing target(s)`;
      this.#persistStatus(rec, rec.status, ok ? "completed" : undefined);
    } catch (err) {
      rec.status = "failed";
      rec.error = err instanceof Error ? err.message : String(err);
      this.#persistStatus(rec, "failed", undefined);
    }
  }

  // --- resolution (reuses upstream loaders + inventory engine) --------------

  async #plan(body: JobBody): Promise<{ descriptors: TargetDescriptor[]; plan: PlanTask[] }> {
    let inventory = body.inventory;
    let dirVars: DirectoryVars = { groupVarsByGroup: {}, hostVarsByHost: {} };
    if (!inventory && body.inventoryPath) {
      const source = new FsProjectSource(dirname(body.inventoryPath));
      inventory = await loadInventoryFile(body.inventoryPath, source);
      dirVars = await resolveDirectoryVars(body.inventoryPath, source);
    }
    let playbook = body.playbook;
    if (!playbook && body.playbookPath) playbook = await loadPlaybookFile(body.playbookPath);
    const firstPlay = Array.isArray(playbook) ? playbook[0] : playbook;

    const inlineTasks = body.tasks ?? firstPlay?.tasks?.map((t) => ({ name: t.name, module: t.module ?? "", args: t.args })) ?? [];
    // Explicit per-run target selection wins; fall back to playbook/host vars, then "all".
    const selected = (body.targets ?? body.hosts) ?? (firstPlay?.hosts as string[] | undefined);
    let patterns = selected ?? ["all"];
    if (body.limit) patterns = [body.limit];

    let matchedNames: string[];
    if (inventory) {
      const resolved = await resolveTargets(inventory, patterns, {
        groupVars: dirVars.groupVarsByGroup,
        hostVars: dirVars.hostVarsByHost,
      });
      matchedNames = resolved.matchedHosts;
    } else {
      matchedNames = Engine.#expandPatterns(patterns, [...this.#fleet.keys()]);
    }

    const baseModule = body.module ?? "ping";
    const plan: PlanTask[] = inlineTasks.length > 0 ? inlineTasks : [{ name: `${body.type}:${baseModule}`, module: baseModule }];
    const descriptors = matchedNames.map((n) => this.#fleet.get(n)).filter((d): d is TargetDescriptor => Boolean(d));
    return { descriptors, plan };
  }

  static #expandPatterns(patterns: string[], keys: string[]): string[] {
    const out = new Set<string>();
    for (const p of patterns) {
      if (p === "all" || p === "*") { for (const k of keys) out.add(k); continue; }
      if (p.includes("*")) {
        const re = new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
        for (const k of keys) if (re.test(k)) out.add(k);
      } else if (keys.includes(p)) {
        out.add(p);
      }
    }
    return [...out].sort();
  }

  // --- per-target execution -------------------------------------------------

  async #executeOne(desc: TargetDescriptor, task: PlanTask, body: JobBody, runId: string): Promise<Outcome> {
    const a = { module: task.module ?? "ping", args: { ...(body.args ?? {}), ...(task.args ?? {}) }, config: body.config, force: body.force === true || body.type === "nonIdempotent" };
    const taskName = `${body.type}:${a.module}`;
    const startedAt = Date.now();
    const t0 = performance.now();
    this.#trace({ runId, host: desc.name, taskName, phase: "start", status: "running", startedAt });
    try {
      let outcome: Outcome;
      switch (desc.kind) {
        case "ssh": outcome = await this.#execSsh(desc, a); break;
        case "local": outcome = await this.#execLocal(desc, a); break;
        case "http": outcome = await this.#execHttp(desc, a); break;
        case "network": outcome = await this.#execNetwork(desc, a); break;
        default: outcome = { host: desc.name, ok: false, changed: false, summary: `unknown transport kind '${String((desc as { kind?: string }).kind)}'` };
      }
      this.#trace({
        runId,
        host: desc.name,
        taskName,
        phase: "end",
        status: outcome.ok ? "ok" : "failed",
        startedAt,
        endedAt: Date.now(),
        durationMs: Math.round(performance.now() - t0),
        detail: { summary: outcome.summary, changed: outcome.changed },
      });
      return outcome;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.#trace({
        runId,
        host: desc.name,
        taskName,
        phase: "end",
        status: "failed",
        startedAt,
        endedAt: Date.now(),
        durationMs: Math.round(performance.now() - t0),
        detail: { error: msg },
      });
      return { host: desc.name, ok: false, changed: false, summary: "execution error", detail: msg };
    }
  }

  /** Best-effort persistence of one execution-trace event via the store (Todo 25). */
  #trace(partial: {
    runId: string;
    host: string;
    taskName: string;
    iteration?: number;
    phase: string;
    status: string;
    startedAt: number;
    endedAt?: number | null;
    durationMs?: number | null;
    detail?: Record<string, unknown>;
  }): void {
    const store = this.#store;
    if (!store) return;
    void store.traces.create({
      runId: partial.runId,
      host: partial.host,
      taskName: partial.taskName,
      iteration: partial.iteration ?? -1,
      phase: partial.phase,
      status: partial.status,
      startedAt: partial.startedAt,
      endedAt: partial.endedAt ?? null,
      durationMs: partial.durationMs ?? null,
      detail: partial.detail ?? {},
    }).catch(() => undefined);
  }

  #isPing(mod: string): boolean {
    return mod === "ping" || mod === "check" || mod === "facts";
  }

  #commandFor(args: Record<string, unknown>): string {
    if (typeof args.command === "string") return args.command;
    if (typeof args.message === "string") return `echo ${args.message}`;
    return typeof args.text === "string" ? `echo ${args.text}` : "true";
  }

  async #execSsh(desc: TargetDescriptor, a: { module: string; args: Record<string, unknown>; force: boolean }): Promise<Outcome> {
    const conn = new SshConnection({
      kind: "ssh", host: desc.host ?? "127.0.0.1", user: desc.user ?? "root", port: desc.port,
      credentials: desc.credentials, knownHostsPath: desc.knownHostsPath, strictHostKeyChecking: false,
      retry: { ...NO_RETRY, ...(desc.retry ?? {}) }, timeoutMs: desc.timeoutMs ?? 8000,
    });
    try {
      await conn.connect();
      const command = this.#isPing(a.module) ? "true" : this.#commandFor(a.args);
      const r = await conn.exec(command);
      return { host: desc.name, ok: r.exitCode === 0, changed: !this.#isPing(a.module), summary: command, detail: { exitCode: r.exitCode, stdout: r.stdout.trim(), stderr: r.stderr.trim() } };
    } finally {
      await conn.disconnect();
    }
  }

  async #execLocal(desc: TargetDescriptor, a: { module: string; args: Record<string, unknown>; force: boolean }): Promise<Outcome> {
    const conn = new LocalConnection({ kind: "local", host: desc.host ?? "localhost", user: desc.user ?? process.env.USER ?? "user", shell: desc.shell, retry: { ...NO_RETRY, ...(desc.retry ?? {}) }, timeoutMs: desc.timeoutMs ?? 8000 });
    try {
      await conn.connect();
      const command = this.#isPing(a.module) ? "true" : this.#commandFor(a.args);
      const r = await conn.exec(command);
      return { host: desc.name, ok: r.exitCode === 0, changed: !this.#isPing(a.module), summary: command, detail: { exitCode: r.exitCode, stdout: r.stdout.trim() } };
    } finally {
      await conn.disconnect();
    }
  }

  async #execHttp(desc: TargetDescriptor, a: { module: string; args: Record<string, unknown>; force: boolean }): Promise<Outcome> {
    const origin = desc.url?.replace(/\/$/, "") ?? "http://127.0.0.1";
    // Ping maps to the conventional health endpoint unless an explicit route is given.
    const route = String(a.args.route ?? (this.#isPing(a.module) ? "GET /ping" : "GET /")).trim();
    const [rawMethod = "GET", rawPath = "/"] = route.split(" ");
    const method = rawMethod.toUpperCase();
    let path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    const headers: Record<string, string> = {};
    if (desc.auth?.type === "basic") headers["authorization"] = `Basic ${Buffer.from(`${desc.auth.user}:${desc.auth.pass}`).toString("base64")}`;
    else if (desc.auth?.type === "token") headers["authorization"] = `Bearer ${desc.auth.token}`;
    const hasBody = ["POST", "PATCH", "PUT"].includes(method);
    const payload = a.args.payload !== undefined ? JSON.stringify(a.args.payload) : undefined;
    try {
      const res = await fetch(`${origin}${path}`, { method, headers, body: hasBody ? payload : undefined, signal: AbortSignal.timeout(desc.timeoutMs ?? 8000) });
      const txt = await res.text();
      let parsed: unknown = null;
      try { parsed = txt ? JSON.parse(txt) : null; } catch { parsed = txt || null; }
      return { host: desc.name, ok: res.ok, changed: hasBody, summary: `${method} ${path}`, detail: { status: res.status, response: parsed } };
    } catch (err) {
      return { host: desc.name, ok: false, changed: false, summary: `${method} ${path} failed`, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  async #execNetwork(desc: TargetDescriptor, a: { module: string; args: Record<string, unknown>; config?: string; force: boolean }): Promise<Outcome> {
    const dev = desc.device as NetworkDeviceSimHandle | undefined;
    if (!dev) return { host: desc.name, ok: false, changed: false, summary: "no device handle" };
    if (this.#isPing(a.module)) {
      const running = dev.showRunning().trim();
      return { host: desc.name, ok: running.length > 0, changed: false, summary: "device reachable", detail: { runningLines: running.split("\n").filter(Boolean).length } };
    }
    // set_config-style apply. Force (non-idempotent) applies WITHOUT checking first.
    const cfg = String(a.config ?? a.args.config ?? "");
    const mode: ApplyOpts["mode"] = a.args.mode === "replace" ? "replace" : "merge";
    const applied = await dev.apply(cfg, { mode, commit: true });
    const issuedCommands = applied.commands.length;
    const deviceChanged = applied.changed;
    const forcedApplied = a.force === true || issuedCommands > 0;
    return { host: desc.name, ok: true, changed: forcedApplied, summary: a.force ? "applied (non-idempotent, not checked)" : deviceChanged ? "applied" : "noop", detail: { deviceChanged, issuedCommands } };
  }

  // --- persistence (best-effort through Task-19 store) ----------------------

  #persistStart(rec: RunRecord, body: JobBody): void {
    const store = this.#store;
    if (!store) return;
    try {
      void store.runs.create({ id: rec.id, actionType: rec.jobType, targetIds: [], status: "queued", startedAt: rec.startedAt, payload: body as unknown as Record<string, unknown> }).catch(() => undefined);
    } catch { /* in-memory record is authoritative */ }
  }

  #persistStatus(rec: RunRecord, status: import("./types").RunStatus, summary?: string): void {
    const store = this.#store;
    if (!store) return;
    void store.runs.update(rec.id, { status, resultSummary: summary, finishedAt: status === "success" || status === "failed" ? Date.now() : undefined }).catch(() => undefined);
  }
}
