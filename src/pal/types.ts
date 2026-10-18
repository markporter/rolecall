// PAL (Portability Abstraction Layer) surface interfaces.
//
// Bun-native implementations live in *.bun.ts; Node-native implementations live in
// *.node.ts (node:sqlite with a bun:sqlite fallback for forced-runtime tests, plus
// node:crypto/dns/child_process/fs/http). The SSH surface remains a Node stub —
// product SSH uses the ssh2 client directly and works on both runtimes.
//
// Selection is gated on detectRuntime() via getPAL() in ./index.ts.

export type SqlBinding =
  | string
  | number
  | bigint
  | boolean
  | null
  | Record<string, string | number | bigint | boolean | null>;

export type SqliteRow = Record<string, unknown>;

export interface SqliteStatement<T = SqliteRow> {
  all(...params: SqlBinding[]): T[];
  get(...params: SqlBinding[]): T | null;
  run(...params: SqlBinding[]): { lastInsertRowid: number | bigint; changes: number };
}

export interface SqliteDb {
  exec(sql: string): void;
  run(sql: string, params?: SqlBinding): { lastInsertRowid: number | bigint; changes: number };
  query<T = SqliteRow>(sql: string): SqliteStatement<T>;
  close(): void;
}

export interface SqlitePAL {
  open(path: string): SqliteDb;
}

export interface CryptoPAL {
  // SHA-256 hex digest. Used later for the idempotency cache key (desired-state hash).
  sha256Hex(input: string | Uint8Array): Promise<string>;
}

export interface DnsPAL {
  // Resolve a hostname to one or more IP addresses.
  lookup(hostname: string): Promise<string[]>;
}

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdin?: string | Uint8Array;
}

export interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SpawnPAL {
  spawn(command: string[], options?: SpawnOptions): Promise<SpawnResult>;
}

export interface HttpServerOptions {
  port: number;
  hostname?: string;
  fetch: (req: Request) => Response | Promise<Response>;
}

export interface HttpServerHandle {
  readonly url: string;
  stop(immediate?: boolean): Promise<void>;
}

export interface HttpPAL {
  /** @summary Boots an HTTP server that dispatches each request to the supplied handler. @param options Port, optional hostname, and the fetch handler. @returns A handle exposing the bound URL and a stop() to shut the server down. */
  serve(options: HttpServerOptions): Promise<HttpServerHandle>;
}

export interface FilePAL {
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface ObservabilityPAL {
  // TODO(ROLECALL-PLACEHOLDER): Observability PAL no-op shim for MVP (real backend deferred)
  // No-op shim for MVP; later wired to a real backend.
  log(level: LogLevel, message: string, fields?: Record<string, unknown>): void;
  metric(name: string, value: number, fields?: Record<string, unknown>): void;
}

export interface SshConnectionOptions {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface SshExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface SshConnection {
  exec(command: string): Promise<SshExecResult>;
  close(): void;
}

export interface SshPAL {
  connect(options: SshConnectionOptions): Promise<SshConnection>;
}

// Aggregate PAL returned by getPAL().
export interface PAL {
  readonly runtime: "bun" | "node";
  sqlite: SqlitePAL;
  crypto: CryptoPAL;
  dns: DnsPAL;
  spawn: SpawnPAL;
  http: HttpPAL;
  file: FilePAL;
  observability: ObservabilityPAL;
  ssh: SshPAL;
}
