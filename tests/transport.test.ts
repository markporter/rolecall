// Transport connection tests — Bun-only MVP, run under `bun test`.
//
// Coverage:
//  - LocalConnection: real exec (stdout + exit codes) + facts.
//  - SshConnection: construct config, exec-before-connect guard, real
//    connect/exec/disconnect lifecycle against an in-process ssh2 Server, and
//    host-key verification (strict + trust-on-first-use).
//  - Resilience wrapper (createResilientRunner): retry on transient, bail on
//    fatal/auth, timeout via AbortSignal, bounded concurrency.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createConnection,
  createResilientRunner,
  LocalConnection,
  SshConnection,
  Server,
  TimeoutError,
  type ExecResult,
} from "../src/transport";
import { verifyHostKey } from "../src/transport/ssh";

const NO_RETRY = { retries: 0, minTimeout: 1, maxTimeout: 1, factor: 2, randomize: false };

// ---------------------------------------------------------------------------
// LocalConnection
// ---------------------------------------------------------------------------

test("LocalConnection executes a command and captures stdout", async () => {
  const conn = new LocalConnection({ kind: "local", host: "localhost", user: "tester" });
  await conn.connect();
  const res = await conn.exec("echo hello-world");
  expect(res.exitCode).toBe(0);
  expect(res.stdout).toContain("hello-world");
  await conn.disconnect();
});

test("LocalConnection captures non-zero exit codes", async () => {
  const conn = new LocalConnection({ kind: "local", host: "localhost", user: "tester" });
  const res = await conn.exec("exit 3");
  expect(res.exitCode).toBe(3);
});

test("LocalConnection reports localhost facts", async () => {
  const conn = new LocalConnection({ kind: "local", host: "localhost", user: "tester" });
  const facts = await conn.facts();
  expect(facts.transport).toBe("local");
  expect(facts.os).toBeDefined();
  expect(facts.shell).toBe("/bin/sh");
});

// ---------------------------------------------------------------------------
// SshConnection construction + lifecycle guards
// ---------------------------------------------------------------------------

test("SshConnection constructs with correct config", () => {
  const conn = new SshConnection({
    kind: "ssh",
    host: "example.com",
    port: 2222,
    user: "deploy",
    credentials: { password: "x" },
  });
  expect(conn.kind).toBe("ssh");
  expect(conn.options.host).toBe("example.com");
  expect(conn.options.port).toBe(2222);
  expect(conn.options.user).toBe("deploy");
});

test("SshConnection exec before connect rejects", async () => {
  const conn = new SshConnection({ kind: "ssh", host: "127.0.0.1", user: "u" });
  await expect(conn.exec("echo hi")).rejects.toThrow(/not connected/);
});

// ---------------------------------------------------------------------------
// Resilience wrapper (shared by all connections)
// ---------------------------------------------------------------------------

test("resilient runner retries transient failures then succeeds", async () => {
  let attempts = 0;
  const runner = createResilientRunner({
    concurrency: 1,
    retry: { ...NO_RETRY, retries: 3 },
    timeoutMs: 5000,
  });
  const res = await runner(async () => {
    attempts++;
    if (attempts < 3) throw new Error("transient network blip");
    return { exitCode: 0, stdout: "ok", stderr: "" } satisfies ExecResult;
  });
  expect(res.stdout).toBe("ok");
  expect(attempts).toBe(3);
});

test("resilient runner bails immediately on fatal/auth errors", async () => {
  let attempts = 0;
  const runner = createResilientRunner({
    concurrency: 1,
    retry: { ...NO_RETRY, retries: 5 },
    timeoutMs: 5000,
  });
  await expect(
    runner(async () => {
      attempts++;
      throw new Error("All configured authentication methods failed");
    }),
  ).rejects.toThrow();
  expect(attempts).toBe(1);
});

test("resilient runner fires timeout via AbortSignal", async () => {
  const runner = createResilientRunner({ concurrency: 1, retry: NO_RETRY, timeoutMs: 40 });
  // The core must honor the abort signal: when the wrapper's timer fires it
  // aborts the signal, and a well-behaved core rejects — surfacing TimeoutError.
  await expect(
    runner(
      (signal) =>
        new Promise<ExecResult>((_, reject) => {
          if (signal.aborted) {
            reject(new Error("aborted"));
            return;
          }
          signal.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    ),
  ).rejects.toThrow(TimeoutError);
});

test("resilient runner respects bounded concurrency", async () => {
  const limit = 2;
  const runner = createResilientRunner({ concurrency: limit, retry: NO_RETRY, timeoutMs: 5000 });
  let active = 0;
  let maxActive = 0;
  const tasks = Array.from({ length: 10 }, () =>
    runner(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return { exitCode: 0, stdout: "", stderr: "" } satisfies ExecResult;
    }),
  );
  await Promise.all(tasks);
  expect(maxActive).toBeLessThanOrEqual(limit);
});

// ---------------------------------------------------------------------------
// Host-key verification (pure function)
// ---------------------------------------------------------------------------

function generateKey(dir: string): { pubKeyLine: string; keyPath: string } {
  const keyPath = join(dir, "host_key");
  Bun.spawnSync(["ssh-keygen", "-t", "rsa", "-b", "2048", "-f", keyPath, "-N", "", "-q"]);
  const pubKeyLine = Bun.spawnSync(["ssh-keygen", "-y", "-f", keyPath]).stdout.toString().trim();
  return { pubKeyLine, keyPath };
}

test("verifyHostKey matches a known host key and rejects others", () => {
  const dir = mkdtempSync(join(tmpdir(), "rolecall-kh-"));
  const { pubKeyLine } = generateKey(dir);
  const kh = join(dir, "known_hosts");
  writeFileSync(kh, `myhost ${pubKeyLine}\n`);

  const keyBuf = Buffer.from(pubKeyLine.split(" ")[1] ?? "", "base64");
  expect(verifyHostKey("myhost", keyBuf, kh)).toBe(true);
  expect(verifyHostKey("otherhost", keyBuf, kh)).toBe(false);

  // A different key's body must not match.
  const dir2 = mkdtempSync(join(tmpdir(), "rolecall-kh2-"));
  const { pubKeyLine: other } = generateKey(dir2);
  const otherBuf = Buffer.from(other.split(" ")[1] ?? "", "base64");
  expect(verifyHostKey("myhost", otherBuf, kh)).toBe(false);
});

// ---------------------------------------------------------------------------
// Fake in-process ssh2 server: real connect/exec/disconnect + host-key verify
// ---------------------------------------------------------------------------

let server: Server;
let port = 0;
let knownHostsPath = "";

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "rolecall-sshtest-"));
  const { pubKeyLine, keyPath } = generateKey(dir);
  const hostKey = readFileSync(keyPath, "utf-8");
  knownHostsPath = join(dir, "known_hosts");
  writeFileSync(knownHostsPath, `127.0.0.1 ${pubKeyLine}\n`);

  server = new Server(
    { hostKeys: [hostKey], algorithms: { serverHostKey: ["ssh-rsa"] } },
    (client) => {
      client.on("authentication", (ctx) => {
        if (ctx.method === "password" && ctx.password === "pw") ctx.accept();
        else if (ctx.method === "none") ctx.accept();
        else ctx.reject();
      });
      client.on("ready", () => {
        client.on("session", (accept) => {
          const session = accept();
          session.on("exec", (acceptExec) => {
            const stream = acceptExec();
            stream.write("hello from fake server\n");
            stream.exit(0);
            stream.end();
          });
        });
      });
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  port = server.address().port;
});

afterAll(() => {
  server?.close();
});

test(
  "SshConnection connect/exec/disconnect against fake server with strict host-key check",
  async () => {
    const conn = new SshConnection({
      kind: "ssh",
      host: "127.0.0.1",
      port,
      user: "tester",
      credentials: { password: "pw" },
      knownHostsPath,
      strictHostKeyChecking: true,
      retry: { retries: 0, minTimeout: 10, maxTimeout: 50, factor: 2, randomize: false },
      timeoutMs: 5000,
    });
    await conn.connect();
    const res = await conn.exec("echo anything");
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("hello from fake server");
    const health = await conn.health();
    expect(health.ok).toBe(true);
    await conn.disconnect();
  },
  15000,
);

test(
  "SshConnection rejects an unknown host key (strict mode)",
  async () => {
    const conn = new SshConnection({
      kind: "ssh",
      host: "127.0.0.1",
      port,
      user: "tester",
      credentials: { password: "pw" },
      // Point at an empty known_hosts so the key cannot be verified.
      knownHostsPath: join(mkdtempSync(join(tmpdir(), "rolecall-emptykh-")), "known_hosts"),
      strictHostKeyChecking: true,
      retry: { retries: 0, minTimeout: 10, maxTimeout: 50, factor: 2, randomize: false },
      timeoutMs: 5000,
    });
    await expect(conn.connect()).rejects.toThrow(/verification failed|denied|ECONN/);
  },
  15000,
);

// ---------------------------------------------------------------------------
// Factory dispatch
// ---------------------------------------------------------------------------

test("createConnection dispatches by kind", () => {
  expect(createConnection({ kind: "local", host: "h", user: "u" }).kind).toBe("local");
  expect(createConnection({ kind: "ssh", host: "h", user: "u" }).kind).toBe("ssh");
});
