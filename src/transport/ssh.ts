// SshConnection — clientless SSH exec over the pure-JS ssh2 Client.
//
// Design notes:
//  - One ssh2 Client per connection; every exec opens a NEW channel on that same
//    client (channel multiplexing) so N concurrent execs share one TCP/SSH
//    session. The connection is only torn down on disconnect().
//  - Host-key verification uses the installed `known-hosts` package for the
//    default ~/.ssh/known_hosts, and a path-configurable parser otherwise.
//  - Keepalive is enabled at connect time (ssh2 has no runtime setter).
//  - Retry/timeout/concurrency are centralized in createResilientRunner
//    (connection.ts); this class only supplies the raw per-channel exec.
import ssh2 from "ssh2";
import { Client } from "ssh2";
// ssh2 is CommonJS and exposes NO named `Server` export to Node's ESM loader
// (cjs-module-lexer detects `Client` but not `Server`), so a plain
// `export { Server } from "ssh2"` crashes under Node with
// "Named export 'Server' not found". Read the class off the CJS default
// (module.exports) instead and re-export it value + type. Bundled/published
// lib/cli.js therefore stays Node-loadable; Bun is unaffected.
export const Server = ssh2.Server;
export type Server = InstanceType<typeof ssh2.Server>;
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import knownHostsDefault from "known-hosts";

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
  type RetryConfig,
  type SshConnectionOptions,
} from "./connection";

interface KnownHostEntry {
  host: string;
  publicKey: string;
}

const KEEPALIVE_INTERVAL_MS = 10_000;
const KEEPALIVE_COUNT_MAX = 3;

/**
 * ssh2's hostVerifier hands us the host public key as an SSH wire blob:
 * `string(type) || key-data`. The key-data portion is identical regardless of
 * which signature algorithm was negotiated (ssh-rsa vs rsa-sha2-256/512 share
 * the same RSA modulus), so we compare ONLY the body after the type field. This
 * is robust to algorithm-name drift between the server's offer and the
 * known_hosts entry (which always records `ssh-rsa` for RSA keys).
 */
function keyBody(blob: Buffer): Buffer {
  const typeLen = blob.readUInt32BE(0);
  return blob.subarray(4 + typeLen);
}

function parseKnownHosts(content: string): KnownHostEntry[] {
  const entries: KnownHostEntry[] = [];
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf(" ");
    if (i === -1) continue;
    const publicKey = line.slice(i + 1).trim();
    for (const host of line.slice(0, i).split(",")) {
      entries.push({ host, publicKey });
    }
  }
  return entries;
}

function loadKnownHosts(customPath?: string): KnownHostEntry[] {
  const path = customPath ?? join(homedir(), ".ssh", "known_hosts");
  if (!existsSync(path)) return [];
  if (!customPath) {
    // Default location: use the installed `known-hosts` package.
    return knownHostsDefault;
  }
  return parseKnownHosts(readFileSync(path, "utf-8"));
}

/**
 * True iff `host` has a known_hosts entry whose key body (modulus/key material,
 * independent of the recorded algorithm name) matches the presented `key`.
 */
export function verifyHostKey(host: string, key: Buffer, knownHostsPath?: string): boolean {
  const body = keyBody(key);
  const entries = loadKnownHosts(knownHostsPath);
  return entries.some((e) => {
    if (e.host !== host) return false;
    // publicKey is `<type> <base64> [comment]`; the base64 is the 2nd token.
    const b64 = e.publicKey.split(" ")[1];
    if (!b64) return false;
    try {
      return keyBody(Buffer.from(b64, "base64")).equals(body);
    } catch {
      return false;
    }
  });
}

export class SshConnection implements Connection {
  readonly kind = "ssh" as const;
  readonly options: SshConnectionOptions;

  #client: Client | null = null;
  #runner: (core: CoreExec, options?: ExecOptions) => Promise<ExecResult>;

  constructor(options: SshConnectionOptions) {
    this.options = options;
    const retry: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...(options.retry ?? {}) };
    this.#runner = createResilientRunner({
      concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
      retry,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
  }

  async connect(): Promise<void> {
    if (this.#client) return;
    const opts = this.options;
    const strict = opts.strictHostKeyChecking ?? true;
    const client = new Client();

    await new Promise<void>((resolve, reject) => {
      client.on("ready", () => resolve());
      client.on("error", (e) => reject(e));
      client.connect({
        host: opts.host,
        port: opts.port ?? 22,
        username: opts.user,
        password: opts.credentials?.password,
        privateKey: opts.credentials?.privateKey,
        passphrase: opts.credentials?.passphrase,
        keepaliveInterval: KEEPALIVE_INTERVAL_MS,
        keepaliveCountMax: KEEPALIVE_COUNT_MAX,
        hostVerifier: (key: Buffer, verify: (ok: boolean) => void) => {
          if (!strict) {
            verify(true);
            return;
          }
          verify(verifyHostKey(opts.host, key, opts.knownHostsPath));
        },
      });
    });

    this.#client = client;
  }

  #rawExec(command: string, _execOptions: ExecOptions | undefined, signal: AbortSignal): Promise<ExecResult> {
    const client = this.#client;
    if (!client) return Promise.reject(new Error("SshConnection: not connected"));

    return new Promise<ExecResult>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        fn();
      };

      client.exec(command, (err, stream) => {
        if (err) {
          finish(() => reject(err));
          return;
        }
        let stdout = "";
        let stderr = "";
        stream.on("data", (d: Buffer) => {
          stdout += d.toString();
        });
        stream.stderr.on("data", (d: Buffer) => {
          stderr += d.toString();
        });
        stream.on("close", (code: number | null) => {
          finish(() => resolve({ exitCode: code, stdout, stderr }));
        });
        stream.on("error", (e: Error) => {
          finish(() => reject(e));
        });

        const onAbort = (): void => {
          finish(() => {
            try {
              stream.close();
            } catch {
              /* channel may already be closed */
            }
            reject(new Error(`SshConnection: aborted (${String(signal.reason ?? "AbortError")})`));
          });
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      });
    });
  }

  exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    return this.#runner((signal) => this.#rawExec(command, options, signal), options);
  }

  async facts(): Promise<ConnectionFacts> {
    const empty: ExecResult = { exitCode: null, stdout: "", stderr: "" };
    const [osRes, userRes] = await Promise.all([
      this.exec("uname -srm").catch(() => empty),
      this.exec("whoami").catch(() => empty),
    ]);
    return {
      host: this.options.host,
      user: userRes.stdout.trim() || this.options.user,
      os: osRes.stdout.trim() || undefined,
      transport: "ssh",
    };
  }

  async health(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await this.exec("true", {
        timeoutMs: Math.min(5000, this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async disconnect(): Promise<void> {
    if (this.#client) {
      this.#client.end();
      this.#client = null;
    }
  }
}
