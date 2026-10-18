// Transport connection primitives — shared interface, options types, and the
// resilience wrapper (bounded concurrency via p-limit + backoff/jitter retry via
// p-retry + hard timeout via AbortSignal) used by every Connection.exec.
//
// This module is transport-agnostic: it defines the contract (Connection) and
// the cross-cutting exec behavior. SSH/Local/Network implementers only supply
// the raw per-command execution; everything else is centralized here so callers
// can fan out safely without re-implementing retry/timeout/concurrency.

import pLimit from "p-limit";
import pRetry, { AbortError, type Options as RetryOptions } from "p-retry";

// ---------------------------------------------------------------------------
// Result / facts / health shapes
// ---------------------------------------------------------------------------

export interface ExecResult {
  /** Process exit code, or null when the channel closed without a code. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface ConnectionFacts {
  host: string;
  user: string;
  /** OS identifier (e.g. "Linux" / "Darwin" / vendor driver name), when known. */
  os?: string;
  /** Login shell path, when known. */
  shell?: string;
  transport: "ssh" | "local" | "network" | "http";
}

export interface HealthStatus {
  ok: boolean;
  /** Round-trip latency in milliseconds, when ok. */
  latencyMs?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Options types
// ---------------------------------------------------------------------------

export interface Credentials {
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface RetryConfig {
  /** Max retry attempts after the first failure. */
  retries: number;
  /** Base backoff in ms before the first retry. */
  minTimeout: number;
  /** Upper bound on a single backoff in ms. */
  maxTimeout: number;
  /** Exponential factor applied to successive backoffs. */
  factor: number;
  /** Add jitter (×1..2) to backoffs to avoid thundering herds. */
  randomize: boolean;
}

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** Per-call hard timeout in ms; overrides the connection default. */
  timeoutMs?: number;
  /** Abort signal; aborting cancels the in-flight attempt. */
  signal?: AbortSignal;
}

export interface BaseConnectionOptions {
  host: string;
  port?: number;
  user: string;
  credentials?: Credentials;
  /** Default exec timeout in ms. */
  timeoutMs?: number;
  /** Partial retry overrides merged onto DEFAULT_RETRY_CONFIG. */
  retry?: Partial<RetryConfig>;
  /** Max concurrent in-flight exec calls (p-limit). */
  concurrency?: number;
}

export interface SshConnectionOptions extends BaseConnectionOptions {
  kind: "ssh";
  /** Path to a known_hosts file; defaults to ~/.ssh/known_hosts. */
  knownHostsPath?: string;
  /** When false, any host key is accepted (insecure; tests/trust-on-first-use). */
  strictHostKeyChecking?: boolean;
}

export interface LocalConnectionOptions extends BaseConnectionOptions {
  kind: "local";
  /** Shell used to evaluate commands; defaults to /bin/sh. */
  shell?: string;
}

/** Vendor CLI semantics for network switches: how to enter config mode, show/commit config, etc. */
export interface VendorDriver {
  readonly name: string;
  /** Command that enters configuration mode (privileged EXEC → config). */
  readonly enterConfig: string;
  /** Command that exits configuration mode back to privileged EXEC. */
  readonly exitConfig: string;
  /** Command that dumps the running configuration. */
  readonly showRunning: string;
  /** Atomic commit of the running configuration. */
  commit(): string;
  /** Commit that auto-reverts after `seconds` unless confirmed. */
  commitConfirmed(seconds: number): string;
  /** Optional post-processing of raw `show running-config` output. */
  parseRunning?(raw: string): string;
}

export interface NetworkConnectionOptions extends BaseConnectionOptions {
  kind: "network";
  /** Vendor CLI driver; defaults to IOS_DRIVER when omitted. */
  driver?: VendorDriver;
  /** Path to a known_hosts file; defaults to ~/.ssh/known_hosts. */
  knownHostsPath?: string;
  /** When false, any host key is accepted (insecure; tests/trust-on-first-use). */
  strictHostKeyChecking?: boolean;
}

export type HttpAuth =
  | { type: "basic"; user: string; pass: string }
  | { type: "token"; token: string }
  | { type: "oauth"; tokenUrl: string; clientId: string; clientSecret: string; scope?: string };

// TODO(ROLECALL-PLACEHOLDER): gRPC capability deferred (throws at connect())
/** Deferred gRPC capability. Presence triggers a deferred error at connect(). */
export interface HttpGrpcCapability {
  service: string;
  method: string;
}

export interface HttpApiRequest {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  headers?: Record<string, string>;
}

export interface HttpApiConnectionOptions extends BaseConnectionOptions {
  kind: "http";
  /** Path prefix prepended to request.path (e.g. "/api/v1"). */
  basePath?: string;
  auth?: HttpAuth;
  /** The configured request issued by exec(). */
  request: HttpApiRequest;
  /** undici Pool max sockets; bounds concurrent in-flight requests. */
  poolSize?: number;
  /** Path used by health(); defaults to request.path. */
  healthPath?: string;
  // TODO(ROLECALL-PLACEHOLDER): gRPC capability deferred (throws at connect())
  /** Deferred gRPC capability — setting this throws at connect(). */
  grpc?: HttpGrpcCapability;
}

export type ConnectionOptions =
  | SshConnectionOptions
  | LocalConnectionOptions
  | NetworkConnectionOptions
  | HttpApiConnectionOptions;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  retries: 3,
  minTimeout: 200,
  maxTimeout: 2000,
  factor: 2,
  randomize: true,
};

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_CONCURRENCY = 4;

export function resolveRetryConfig(override?: Partial<RetryConfig>): RetryConfig {
  return { ...DEFAULT_RETRY_CONFIG, ...(override ?? {}) };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TimeoutError extends Error {
  constructor(public readonly ms: number) {
    super(`Operation timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * Errors that must NOT be retried — retrying them is futile and wastes the
 * retry budget. Covers auth failures, permission denials, host-key mismatches,
 * and unparseable credentials. Transient network blips (timeouts, resets,
 * refusals during a rolling restart) are deliberately NOT in this set so they
 * are retried.
 */
export function isFatalError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /authentication/i.test(msg) ||
    /permission denied/i.test(msg) ||
    /all configured authentication methods failed/i.test(msg) ||
    /no supported authentication methods/i.test(msg) ||
    /host key verification failed/i.test(msg) ||
    /cannot parse privatekey/i.test(msg) ||
    /cannot parse key/i.test(msg)
  );
}

// ---------------------------------------------------------------------------
// Resilience wrapper
// ---------------------------------------------------------------------------

export type CoreExec = (signal: AbortSignal) => Promise<ExecResult>;

export interface ResilienceConfig {
  concurrency: number;
  retry: RetryConfig;
  timeoutMs: number;
}

/**
 * Build a runner that wraps a raw per-command executor with:
 *  - bounded concurrency (p-limit) so callers can fan out safely,
 *  - a hard timeout via AbortSignal (rejects with TimeoutError),
 *  - exponential backoff + jitter retry (p-retry) that bails immediately on
 *    fatal/auth errors (see isFatalError).
 *
 * The returned runner takes the core executor and optional per-call ExecOptions
 * (which may override timeoutMs and supply an AbortSignal).
 */
export function createResilientRunner(
  config: ResilienceConfig,
): (core: CoreExec, options?: ExecOptions) => Promise<ExecResult> {
  const limit = pLimit(Math.max(1, config.concurrency));

  return (core: CoreExec, options?: ExecOptions): Promise<ExecResult> =>
    limit(async () => {
      const timeoutMs = options?.timeoutMs ?? config.timeoutMs;
      const parent = options?.signal;
      const controller = new AbortController();
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort(new TimeoutError(timeoutMs));
        }, timeoutMs);
        // Don't keep the event loop alive solely for the timeout.
        const t = timer as unknown as { unref?: () => void };
        if (typeof t.unref === "function") t.unref();
      }

      const onParentAbort = () => controller.abort(parent?.reason);
      if (parent) {
        if (parent.aborted) controller.abort(parent.reason);
        else parent.addEventListener("abort", onParentAbort, { once: true });
      }

      const retryOptions: RetryOptions = {
        retries: config.retry.retries,
        minTimeout: config.retry.minTimeout,
        maxTimeout: config.retry.maxTimeout,
        factor: config.retry.factor,
        randomize: config.retry.randomize,
        signal: controller.signal,
        shouldRetry: (ctx) => !isFatalError(ctx.error),
      };

      try {
        return await pRetry(() => core(controller.signal), retryOptions);
      } catch (err) {
        if (timedOut) throw new TimeoutError(timeoutMs);
        throw err;
      } finally {
        if (timer) clearTimeout(timer);
        if (parent) parent.removeEventListener("abort", onParentAbort);
      }
    });
}

// ---------------------------------------------------------------------------
// Connection contract
// ---------------------------------------------------------------------------

export interface Connection {
  readonly kind: "ssh" | "local" | "network" | "http";
  /** Establish the underlying transport (idempotent once connected). */
  connect(): Promise<void>;
  /** Run a command, returning captured stdout/stderr/exit code. */
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  /** Best-effort targeted fact gathering for the target. */
  facts(): Promise<ConnectionFacts>;
  /** Tear down the underlying transport. */
  disconnect(): Promise<void>;
  /** Liveness probe (trivial command + latency). */
  health(): Promise<HealthStatus>;
}

// Re-export so callers can reference the AbortError type if needed.
export { AbortError };
