// NetworkSshConnection tests — Bun-only MVP, run under `bun test`.
//
// Coverage:
//  - diff helper: identical configs → no change; conflicting → added/removed lines.
//  - NetworkSshConnection.apply(): idempotent when desired == running (zero
//    commands, no commit); conflicting candidate → delta applied + commit; commit
//    only fires when a diff is present; revert timer arms a confirmed commit.
//  - planCommit(): pure revert-timer logic unit test.
//  - Factory dispatch + facts() report the network transport.
//
// The device is an in-process ssh2 Server returning scripted IOS-like responses
// (no docker/lxc available — see inherited wisdom).
/// <reference path="../src/pal/ssh2.d.ts" />
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createConnection,
  diffConfigs,
  IOS_DRIVER,
  NetworkSshConnection,
  normalizeConfig,
  planCommit,
  Server,
  type ApplyResult,
} from "../src/transport";
import type {
  ServerAuthContext,
  ServerConnection,
  ServerExecInfo,
  ServerSession,
  ServerStream,
} from "ssh2";

const NO_RETRY = { retries: 0, minTimeout: 1, maxTimeout: 1, factor: 2, randomize: false };

// Scripted device state: the mock server answers `show running-config` with this.
let runningConfig = "";

let server: Server;
let port = 0;
let knownHostsPath = "";

function generateKey(dir: string): { pubKeyLine: string; keyPath: string } {
  const keyPath = join(dir, "host_key");
  Bun.spawnSync(["ssh-keygen", "-t", "rsa", "-b", "2048", "-f", keyPath, "-N", "", "-q"]);
  const pubKeyLine = Bun.spawnSync(["ssh-keygen", "-y", "-f", keyPath]).stdout.toString().trim();
  return { pubKeyLine, keyPath };
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "rolecall-net-"));
  const { pubKeyLine, keyPath } = generateKey(dir);
  const hostKey = readFileSync(keyPath, "utf-8");
  knownHostsPath = join(dir, "known_hosts");
  writeFileSync(knownHostsPath, `127.0.0.1 ${pubKeyLine}\n`);

  server = new Server(
    { hostKeys: [hostKey], algorithms: { serverHostKey: ["ssh-rsa"] } },
    (client: ServerConnection) => {
      client.on("authentication", (ctx: ServerAuthContext) => {
        if (ctx.method === "password" && ctx.password === "pw") ctx.accept();
        else if (ctx.method === "none") ctx.accept();
        else ctx.reject();
      });
      client.on("ready", () => {
        client.on("session", (accept: () => ServerSession) => {
          const session = accept();
          session.on("exec", (acceptExec: () => ServerStream, _reject: () => void, info: ServerExecInfo) => {
            const stream = acceptExec();
            const cmd = info.command.toString();
            if (cmd.includes("show running-config")) {
              stream.write(runningConfig + "\n");
            } else {
              stream.write("OK\n");
            }
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

beforeEach(() => {
  runningConfig = "";
});

function netConn(): NetworkSshConnection {
  return new NetworkSshConnection({
    kind: "network",
    host: "127.0.0.1",
    port,
    user: "tester",
    credentials: { password: "pw" },
    knownHostsPath,
    strictHostKeyChecking: true,
    retry: NO_RETRY,
    timeoutMs: 5000,
  });
}

// ---------------------------------------------------------------------------
// diff helper (pure)
// ---------------------------------------------------------------------------

test("normalizeConfig: CRLF→LF and trailing whitespace/blank lines stripped", () => {
  expect(normalizeConfig("a\r\nb \r\n")).toBe("a\nb");
  expect(normalizeConfig("a\nb\n")).toBe("a\nb");
  expect(normalizeConfig("a\nb")).toBe("a\nb");
});

test("diffConfigs: identical configs report no change", () => {
  const d = diffConfigs("hostname sw1\ninterface Gi0/1\n", "hostname sw1\ninterface Gi0/1\n");
  expect(d.changed).toBe(false);
  expect(d.added).toEqual([]);
  expect(d.removed).toEqual([]);
});

test("diffConfigs: conflicting configs report added/removed lines", () => {
  const running = "hostname sw1\ninterface Gi0/1\n description old\n";
  const candidate = "hostname sw1\ninterface Gi0/1\n description new\n";
  const d = diffConfigs(candidate, running);
  expect(d.changed).toBe(true);
  expect(d.added).toEqual([" description new"]);
  expect(d.removed).toEqual([" description old"]);
});

// ---------------------------------------------------------------------------
// apply(): idempotency + diff + commit
// ---------------------------------------------------------------------------

test("apply: identical desired state → zero commands, no commit (idempotent)", async () => {
  const candidate = "hostname sw1\ninterface Gi0/1\n";
  runningConfig = candidate;
  const conn = netConn();
  await conn.connect();
  const res: ApplyResult = await conn.apply(candidate);
  expect(res.changed).toBe(false);
  expect(res.commands).toEqual([]);
  expect(res.committed).toBe(false);
  expect(res.added).toEqual([]);
  await conn.disconnect();
});

test("apply: conflicting candidate → delta applied and committed", async () => {
  runningConfig = "hostname sw1\ninterface Gi0/1\n description old\n";
  const candidate = "hostname sw1\ninterface Gi0/1\n description new\n";
  const conn = netConn();
  await conn.connect();
  const res = await conn.apply(candidate);
  expect(res.changed).toBe(true);
  expect(res.added).toEqual([" description new"]);
  expect(res.removed).toEqual([" description old"]);
  // commands: enter config, the added delta line, exit config, commit.
  expect(res.commands).toContain("configure terminal");
  expect(res.commands).toContain(" description new");
  expect(res.commands).toContain("end");
  expect(res.commands).toContain("copy running-config startup-config");
  expect(res.committed).toBe(true);
  await conn.disconnect();
});

test("apply: commit only fires when a diff is present", async () => {
  const candidate = "hostname sw1\n";
  runningConfig = candidate;
  const conn = netConn();
  await conn.connect();

  // Unchanged → no commit.
  const unchanged = await conn.apply(candidate);
  expect(unchanged.committed).toBe(false);

  // Changed but commit disabled → not committed.
  runningConfig = "hostname other\n";
  const dryRun = await conn.apply(candidate, { commit: false });
  expect(dryRun.changed).toBe(true);
  expect(dryRun.committed).toBe(false);
  expect(dryRun.commands).not.toContain("copy running-config startup-config");

  // Changed + commit → committed.
  const applied = await conn.apply(candidate);
  expect(applied.committed).toBe(true);
  await conn.disconnect();
});

test("apply: revert_in arms a device-side confirmed commit", async () => {
  runningConfig = "hostname old\n";
  const candidate = "hostname new\n";
  const conn = netConn();
  await conn.connect();
  const res = await conn.apply(candidate, { revertInSeconds: 30 });
  expect(res.committed).toBe(true);
  expect(res.commands).toContain("commit confirmed 30");
  await conn.disconnect();
});

test("apply: replace mode sends the whole candidate inside config mode", async () => {
  runningConfig = "hostname old\nline a\n";
  const candidate = "hostname new\nline b\n";
  const conn = netConn();
  await conn.connect();
  const res = await conn.apply(candidate, { mode: "replace" });
  expect(res.changed).toBe(true);
  expect(res.commands).toContain("hostname new");
  expect(res.commands).toContain("line b");
  expect(res.commands).not.toContain("line a");
  await conn.disconnect();
});

// ---------------------------------------------------------------------------
// planCommit (pure revert-timer logic)
// ---------------------------------------------------------------------------

test("planCommit: plain commit vs confirmed commit with revert timer", () => {
  const plain = planCommit(IOS_DRIVER);
  expect(plain.reverts).toBe(false);
  expect(plain.command).toBe("copy running-config startup-config");

  const confirmed = planCommit(IOS_DRIVER, 60);
  expect(confirmed.reverts).toBe(true);
  expect(confirmed.revertInSeconds).toBe(60);
  expect(confirmed.command).toBe("commit confirmed 60");

  // Zero/negative revert is treated as a plain commit.
  expect(planCommit(IOS_DRIVER, 0).reverts).toBe(false);
});

// ---------------------------------------------------------------------------
// Factory + facts
// ---------------------------------------------------------------------------

test("createConnection dispatches kind 'network' to NetworkSshConnection", () => {
  const conn = createConnection({ kind: "network", host: "h", user: "u" });
  expect(conn.kind).toBe("network");
});

test("NetworkSshConnection.facts reports the network transport + driver", async () => {
  const conn = netConn();
  const facts = await conn.facts();
  expect(facts.transport).toBe("network");
  expect(facts.os).toBe("ios");
  expect(facts.host).toBe("127.0.0.1");
});
