// LocalConnection — runs commands on the localhost via node:child_process.spawnSync.
//
// Commands are evaluated through the system shell (default /bin/sh -c) so the
// exec contract matches SshConnection (which also runs via the remote shell).
// Retry is disabled by default for local exec (failures are not transient), but
// the same bounded-concurrency + timeout wrapper from connection.ts applies so
// callers fan out identically across SSH and Local targets.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  buildDockerCommand,
  buildNamespaceCommand,
  EgressPolicy,
  IsolationUnavailableError,
  probeIsolation,
  startEgressBroker,
  resolveShimCliPath,
  type EgressBrokerHandle,
  type IsolationOptions,
} from "../isolation";
import {
  type Connection,
  type ConnectionFacts,
  type CoreExec,
  createResilientRunner,
  DEFAULT_CONCURRENCY,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_TIMEOUT_MS,
  type ExecOptions,
  type ExecResult,
  type HealthStatus,
  type LocalConnectionOptions,
  type RetryConfig,
} from "./connection";

const DEFAULT_SHELL = "/bin/sh";

export class LocalConnection implements Connection {
  readonly kind = "local" as const;
  readonly options: LocalConnectionOptions;

  #shell: string;
  #runner: (core: CoreExec, options?: ExecOptions) => Promise<ExecResult>;
  #isolation?: { backend: "namespace" | "docker"; options: IsolationOptions };
  #isolationError?: IsolationUnavailableError;
  #egress?: {
    dir: string;
    broker: EgressBrokerHandle;
    proxyPort: number;
    shimFile: string;
    shimArgs: string[];
    binds?: Array<{ source: string; target: string }>;
  };
  #egressStarting?: Promise<void>;

  constructor(options: LocalConnectionOptions) {
    this.options = options;
    this.#shell = options.shell ?? DEFAULT_SHELL;
    // Local failures are not transient: default to no retry, but keep timeout +
    // concurrency. Callers may still override via options.retry.
    const retry: RetryConfig = {
      ...DEFAULT_RETRY_CONFIG,
      ...(options.retry ?? { retries: 0 }),
    };
    this.#runner = createResilientRunner({
      concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
      retry,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    this.#resolveIsolation(options.isolation);
  }

  #resolveIsolation(options: IsolationOptions | undefined): void {
    if (!options || options.backend === undefined || options.backend === "none") return;
    const probe = probeIsolation({ backend: options.backend, ...(options.image ? { image: options.image } : {}) });
    if (probe.selected === "none") {
      this.#isolationError = new IsolationUnavailableError(
        `local isolation backend '${options.backend}' is unavailable: ${probe.warnings.join("; ") || "no usable backend"}. ` +
          "Install bubblewrap (Linux) or Docker, or rerun with --isolation none as an explicit, warned last resort (ADR 0025).",
      );
      return;
    }
    this.#isolation = { backend: probe.selected as "namespace" | "docker", options };
  }

  async connect(): Promise<void> {
    await this.#ensureEgress();
  }

  async #ensureEgress(): Promise<void> {
    if (!this.#isolation) return;
    const iso = this.#isolation.options;
    if (!iso.egress || iso.egress.length === 0) return;
    if ((iso.network ?? "module") === "on") return;
    if (this.#egress) return;
    if (this.#egressStarting) return this.#egressStarting;
    this.#egressStarting = (async () => {
      const dir = mkdtempSync(join(tmpdir(), "rolecall-egress-"));
      try {
        const auditPath = process.env["ROLECALL_EGRESS_AUDIT"];
        const broker = await startEgressBroker({
          policy: new EgressPolicy(iso.egress!),
          socketPath: join(dir, "egress.sock"),
          ...(auditPath
            ? { audit: (e: import("../isolation").EgressAuditEvent) => appendFileSync(auditPath, `${JSON.stringify(e)}\n`) }
            : {}),
        });
        const proxyPort = await freePort();
        const projectRoot = iso.projectRoot ?? process.cwd();
        const runtimePath = resolve(process.execPath);
        const runtime = basename(runtimePath).replace(/\.exe$/i, "");
        const inSystemPath = ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/opt"].some(
          (p) => runtimePath === p || runtimePath.startsWith(`${p}/`),
        );
        const binds: Array<{ source: string; target: string }> = [];
        let shimFile = runtimePath;
        let shimArgs = ["__egress-shim"];
        const entry = resolveShimCliPath();
        if ((runtime === "bun" || runtime === "node") && entry) {
          const script = entry;
          let scriptPath = script;
          if (!(script.startsWith(`${projectRoot}/`) || script === projectRoot)) {
            binds.push({ source: script, target: "/run/rolecall/cli.js" });
            scriptPath = "/run/rolecall/cli.js";
          }
          if (!inSystemPath) {
            binds.push({ source: runtimePath, target: "/run/rolecall/runtime" });
            shimFile = "/run/rolecall/runtime";
          }
          shimArgs = [scriptPath, "__egress-shim"];
        } else {
          binds.push({ source: runtimePath, target: "/run/rolecall/rolecall" });
          shimFile = "/run/rolecall/rolecall";
        }
        this.#egress = {
          dir,
          broker,
          proxyPort,
          shimFile,
          shimArgs,
          ...(binds.length > 0 ? { binds } : {}),
        };
      } catch (err) {
        rmSync(dir, { recursive: true, force: true });
        throw err;
      }
    })().finally(() => {
      this.#egressStarting = undefined;
    });
    return this.#egressStarting;
  }

  async #rawExec(command: string, execOptions: ExecOptions | undefined, _signal: AbortSignal): Promise<ExecResult> {
    if (this.#isolationError) throw this.#isolationError;
    await this.#ensureEgress();

    const env = execOptions?.env
      ? (Object.fromEntries(
          Object.entries(execOptions.env).filter(([, v]) => v !== undefined),
        ) as Record<string, string>)
      : undefined;
    const timeoutMs = execOptions?.timeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    if (!this.#isolation) {
      const result = spawnSync(this.#shell, ["-c", command], {
        cwd: execOptions?.cwd,
        env,
        encoding: "utf8",
        timeout: timeoutMs,
      });
      if (result.error) throw result.error;
      return { exitCode: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    }

    const iso = this.#isolation.options;
    const projectRoot = iso.projectRoot ?? process.cwd();
    const networkMode = iso.network ?? "module";
    const network =
      networkMode === "on" || (networkMode === "module" && execOptions?.profile === "networked")
        ? "on"
        : "off";
    const build = this.#isolation.backend === "namespace" ? buildNamespaceCommand : buildDockerCommand;
    const built = build({
      shell: this.#shell,
      command,
      ...(execOptions?.cwd ? { cwd: execOptions.cwd } : {}),
      ...(env ? { env } : {}),
      projectRoot,
      network,
      ...(iso.mounts ? { mounts: iso.mounts } : {}),
      ...(iso.image ? { image: iso.image } : {}),
      ...(this.#egress
        ? {
            egress: {
              socketDir: this.#egress.dir,
              shim: { file: this.#egress.shimFile, args: this.#egress.shimArgs },
              ...(this.#egress.binds ? { binds: this.#egress.binds } : {}),
              proxyPort: this.#egress.proxyPort,
            },
          }
        : {}),
      ...(typeof process.getuid === "function" ? { uid: process.getuid() } : {}),
      ...(typeof process.getgid === "function" ? { gid: process.getgid() } : {}),
    });
    return await new Promise<ExecResult>((resolve, reject) => {
      const child = spawn(built.file, built.args, {
        env: built.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
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
      child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
      child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
      child.on("error", (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code) => {
        if (timer) clearTimeout(timer);
        resolve({ exitCode: code ?? 1, stdout, stderr });
      });
    });
  }

  exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    return this.#runner((signal) => this.#rawExec(command, options, signal), options);
  }

  async facts(): Promise<ConnectionFacts> {
    return {
      host: this.options.host || "localhost",
      user: this.options.user || (process.env["USER"] ?? process.env["USERNAME"] ?? "unknown"),
      os: process.platform,
      shell: this.#shell,
      transport: "local",
    };
  }

  async health(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const res = await this.exec("true", {
        timeoutMs: Math.min(5000, this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      return { ok: res.exitCode === 0, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async disconnect(): Promise<void> {
    if (this.#egress) {
      const { dir, broker } = this.#egress;
      this.#egress = undefined;
      await broker.close().catch(() => undefined);
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

/** Pick a loopback port for the in-sandbox shim (close-then-reuse race is acceptable for an ephemeral port). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}
