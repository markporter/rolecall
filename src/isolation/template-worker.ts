// Sandboxed template renderer (ADR 0025 §7).
//
// The parent sends {engine, template, vars} to a hidden `__render-template`
// worker running under bwrap/Docker. The worker gets no project mounts, no
// network, and no inherited environment; only the runtime/CLI files are bound
// read-only. One process per render for now (a persistent worker is a later
// optimization).

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { buildDockerCommand, buildNamespaceCommand } from "./command";
import { probeIsolation } from "./probe";
import { resolveShimCliPath } from "./shim-entry";
import { IsolationUnavailableError, type IsolationOptions } from "./types";

export interface RenderTemplateOptions {
  engine: "jinja" | "eta" | "ejs";
  template: string;
  vars: Record<string, unknown>;
  isolation: IsolationOptions;
  timeoutMs?: number;
}

interface WorkerInvocation {
  file: string;
  args: string[];
  binds: Array<{ source: string; target: string }>;
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function workerInvocation(projectRoot: string): WorkerInvocation {
  const runtimePath = resolve(process.execPath);
  const runtime = basename(runtimePath).replace(/\.exe$/i, "");
  const inSystem = ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/opt"].some(
    (p) => runtimePath === p || runtimePath.startsWith(`${p}/`),
  );
  const binds: Array<{ source: string; target: string }> = [];
  let file = runtimePath;
  let args: string[] = ["__render-template"];
  if ((runtime === "bun" || runtime === "node") && resolveShimCliPath()) {
    const entry = resolveShimCliPath()!;
    if (!inSystem) {
      binds.push({ source: runtimePath, target: "/run/rolecall/runtime" });
      file = "/run/rolecall/runtime";
    }
    // The source CLI imports sibling modules, so bind its package root
    // read-only rather than copying just index.ts.
    const root = entry.endsWith("/src/cli/index.ts")
      ? resolve(dirname(entry), "../..")
      : entry.endsWith("/lib/cli.js")
        ? resolve(dirname(entry), "..")
        : dirname(entry);
    binds.push({ source: root, target: root });
    args = [entry, "__render-template"];
  } else {
    binds.push({ source: runtimePath, target: "/run/rolecall/rolecall" });
    file = "/run/rolecall/rolecall";
  }
  return { file, args, binds };
}

function runProcess(
  file: string,
  args: string[],
  stdin: string,
  env: Record<string, string> | undefined,
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, args, { stdio: ["pipe", "pipe", "pipe"], ...(env ? { env } : {}) });
    let stdout = "";
    let stderr = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try { child.kill("SIGTERM"); } catch { /* already exited */ }
      }, timeoutMs);
    }
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (c: string) => { stdout += c; });
    child.stderr?.on("data", (c: string) => { stderr += c; });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolvePromise({ code, stdout, stderr });
    });
    child.stdin?.end(stdin);
  });
}

/** Render a template inside the isolated worker. Throws if no backend exists. */
export async function renderTemplateIsolated(options: RenderTemplateOptions): Promise<string> {
  const probe = probeIsolation({
    backend: options.isolation.backend ?? "auto",
    ...(options.isolation.image ? { image: options.isolation.image } : {}),
  });
  if (probe.selected === "none") {
    throw new IsolationUnavailableError(
      `template rendering requires an isolation backend: ${probe.warnings.join("; ") || "none available"}`,
    );
  }

  const dir = mkdtempSync(join(tmpdir(), "rolecall-template-"));
  try {
    const invocation = workerInvocation(dir);
    const command = [invocation.file, ...invocation.args].map(shQuote).join(" ");
    const build = probe.selected === "namespace" ? buildNamespaceCommand : buildDockerCommand;
    const built = build({
      shell: "/bin/sh",
      command,
      projectRoot: dir,
      network: "off",
      // Runtime libs only; do not expose /etc or the host project.
      systemPaths: ["/usr", "/lib", "/lib64", "/bin", "/sbin"],
      binds: invocation.binds,
      ...(options.isolation.image ? { image: options.isolation.image } : {}),
      ...(typeof process.getuid === "function" ? { uid: process.getuid() } : {}),
      ...(typeof process.getgid === "function" ? { gid: process.getgid() } : {}),
    });
    const payload = JSON.stringify({
      engine: options.engine,
      template: options.template,
      vars: options.vars,
      strict: false,
    });
    const result = await runProcess(
      built.file,
      built.args,
      payload,
      built.env,
      options.timeoutMs ?? 30_000,
    );
    let parsed: { ok?: boolean; output?: unknown; error?: unknown };
    try {
      parsed = JSON.parse(result.stdout) as typeof parsed;
    } catch {
      throw new Error(
        `template worker failed (exit ${result.code ?? "?"}): ${result.stderr.trim() || result.stdout.trim() || "no output"}`,
      );
    }
    if (!parsed.ok) throw new Error(`template worker: ${String(parsed.error ?? "unknown error")}`);
    return String(parsed.output ?? "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
