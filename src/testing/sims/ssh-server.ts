// In-process SSH server simulator for OFFLINE integration tests.
//
 // Reuses the pure-JS ssh2 Server (works on Bun when installed --omit=optional;
 // see .omo/notepads/rolecall/issues.md). No docker/lxc/podman required — the entire
 // stack runs in-process so `bun test` stays green everywhere.
 //
 // Matches the established pattern from tests/network.test.ts + facts.test.ts:
 //   - RSA host key via `algorithms: { serverHostKey: ["ssh-rsa"] }` so the
 //     negotiated host-key blob matches a known_hosts entry recorded as `ssh-rsa`.
 //   - exec handler keyed on command text (`info.command.toString()` at runtime —
 //     the ambient ssh2.d.ts types it as string but it is a Buffer).
 //   - Configurable auth: accepts a client publickey (the sim generates an RSA
 //     keypair and returns its private material) plus optional password / none.
 import { readFileSync, writeFileSync } from "node:fs";
 import { join } from "node:path";
 /// <reference path="../../src/pal/ssh2.d.ts" />
 import { Server } from "ssh2";
 import type {
   ServerAuthContext,
   ServerConnection,
   ServerExecInfo,
   ServerSession,
   ServerStream,
 } from "ssh2";
 import { SshConnection } from "../../transport/ssh";
 import { FsScratchStore } from "../../vfs/fs-scratch-store.js";

export interface SshSimOptions {
  /** Client username the returned handle reports. Default "tester". */
  user?: string;
  /** Accepted password (optional). When set, only this password authenticates. */
  password?: string;
  /** Scripted responses keyed on exact command text (case-sensitive match). */
  execHandlers?: Record<string, string>;
  /** Dynamic responder returning null falls through to stdoutDefault. */
  execResponder?: (command: string) => string | null;
  /** Fallback exec output when nothing matches. Default "". */
  stdoutDefault?: string;
  /** Fixed port to listen on (e.g. 39521); 0 = ephemeral. Default 39521. */
  port?: number;
  /** Bind address used both for listening and the known_hosts entry. */
  host?: string;
  /** Temp dir override (mainly for deterministic tests). Auto-created otherwise. */
  keyDir?: string;
}

export interface SshSimHandle {
  host: string;
  port: number;
  user: string;
  /** Path to the RSA private key the client authenticates with (publickey). */
  privateKeyPath: string;
  /** Path to a known_hosts file matching the server's RSA host key. */
  knownHostsPath: string;
  /** Liveness probe: connect + exec "true". Resolves false on any failure. */
  health(timeoutMs?: number): Promise<boolean>;
  close(): void;
}

const DEFAULT_PORT = 39521;
const NO_RETRY = { retries: 0, minTimeout: 10, maxTimeout: 50, factor: 2, randomize: false };

/** Generate an RSA keypair into `dir`; return `{ privPath, pubKeyLine }`. */
function generateRsa(dir: string): { privPath: string; pubKeyLine: string } {
  const privPath = join(dir, "id_rsa");
  Bun.spawnSync(
    ["ssh-keygen", "-t", "rsa", "-b", "2048", "-f", privPath, "-N", "", "-q"],
    { stdout: "ignore", stderr: "ignore" },
  );
  const pubKeyLine = Bun.spawnSync(["ssh-keygen", "-y", "-f", privPath], {
    stdout: "pipe",
    stderr: "ignore",
  })
    .stdout.toString()
    .trim();
  if (!pubKeyLine) throw new Error("createSshSim: failed to derive public key from generated RSA key");
  return { privPath, pubKeyLine };
}

export async function createSshSim(opts: SshSimOptions = {}): Promise<SshSimHandle> {
  const user = opts.user ?? "tester";
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? DEFAULT_PORT;
  const defaultOut = opts.stdoutDefault ?? "";

  // Use FsScratchStore for the temp directory (implements ScratchVfs).
  // If opts.keyDir is provided, use it directly for deterministic tests.
  const scratchStore = opts.keyDir
    ? { directory: opts.keyDir } as { directory: string }
    : new FsScratchStore();
  const baseDir = scratchStore.directory;

  const { privPath, pubKeyLine } = generateRsa(baseDir);
  const hostKey = readFileSync(privPath, "utf-8"); // ssh2 reads OpenSSH-formatted keys

  const knownHostsPath = join(baseDir, "known_hosts");
  writeFileSync(knownHostsPath, `${host} ${pubKeyLine}\n`);

  const handlers = opts.execHandlers ?? {};
  const responder = opts.execResponder;

  let server: Server | null = null;
  await new Promise<void>((resolve, reject) => {
    const srv = new Server(
      { hostKeys: [hostKey], algorithms: { serverHostKey: ["ssh-rsa"] } },
      (client: ServerConnection) => {
        client.on("authentication", (ctx: ServerAuthContext) => {
          switch (ctx.method) {
            case "password":
              ctx.password === opts.password ? ctx.accept() : ctx.reject();
              break;
            case "publickey":
              // The sim owns the keypair the client presents; trust any offer.
              ctx.accept();
              break;
            case "none":
              ctx.accept();
              break;
            default:
              ctx.reject();
          }
        });
        client.on("ready", () => {
          client.on("session", (acceptSession: () => ServerSession) => {
            const session = acceptSession();
            session.on(
              "exec",
              (acceptExec: () => ServerStream, _reject: () => void, info: ServerExecInfo) => {
                const stream = acceptExec();
                const cmd = info.command.toString();
                let out: string | null = null;
                if (responder) {
                  out = responder(cmd);
                } else if (Object.prototype.hasOwnProperty.call(handlers, cmd)) {
                  out = handlers[cmd] ?? "";
                }
                if (out === null) out = defaultOut;
                stream.write(out.endsWith("\n") ? out : `${out}\n`);
                stream.exit(0);
                stream.end();
              },
            );
          });
        });
        client.on("close", () => {});
      },
    );
    server = srv;
    try {
      srv.listen(port, host, () => resolve());
    } catch (e) {
      reject(e);
    }
  });

  // Bound port is authoritative for ephemeral (port: 0) requests; reuse it so
  // health() connects to where the server actually listens.
  const boundPort = server!.address().port;
  return {
    host,
    port: boundPort,
    user,
    privateKeyPath: privPath,
    knownHostsPath,
    async health(timeoutMs = 4000): Promise<boolean> {
      const conn = new SshConnection({
        kind: "ssh",
        host,
        port: boundPort,
        user,
        credentials: { privateKey: readFileSync(privPath, "utf-8") },
        knownHostsPath,
        strictHostKeyChecking: true,
        retry: NO_RETRY,
        timeoutMs,
      });
      try {
        await conn.connect();
        await conn.exec("true");
        return true;
      } catch {
        return false;
      } finally {
        await conn.disconnect();
      }
    },
    close(): void {
      try {
        server?.close();
      } catch {
        /* already closed */
      }
      server = null;
    },
  };
}
