// LocalConnection — runs commands on the localhost via node:child_process.spawnSync.
//
// Commands are evaluated through the system shell (default /bin/sh -c) so the
// exec contract matches SshConnection (which also runs via the remote shell).
// Retry is disabled by default for local exec (failures are not transient), but
// the same bounded-concurrency + timeout wrapper from connection.ts applies so
// callers fan out identically across SSH and Local targets.
import { spawnSync } from "node:child_process";
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
  }

  async connect(): Promise<void> {
    // Local transport is always present; nothing to establish.
  }

  async #rawExec(command: string, execOptions: ExecOptions | undefined, _signal: AbortSignal): Promise<ExecResult> {
    const env = execOptions?.env
      ? (Object.fromEntries(
          Object.entries(execOptions.env).filter(([, v]) => v !== undefined),
        ) as Record<string, string>)
      : undefined;

    const result = spawnSync(this.#shell, ["-c", command], {
      cwd: execOptions?.cwd,
      env,
      encoding: "utf8",
    });
    if (result.error) throw result.error;

    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    return { exitCode: result.status ?? 1, stdout, stderr };
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
    // Nothing to tear down for a local transport.
  }
}
