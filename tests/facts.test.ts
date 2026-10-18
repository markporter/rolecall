// Facts module tests — Bun-only MVP, run under `bun test`.
//
// Coverage (per Todo 14 acceptance):
//  (a) gathered facts object has the expected subset keys matching the fixture
//  (b) repeated gather returns the CACHED copy (same reference)
//  (c) facts are available in a subsequent task render (merged into vars, a
//      template using a fact renders correctly via context.ts renderArgs/evalWhen)
//  (d) unreachable host -> graceful partial, other hosts still gathered
//  + custom FactPlugin (targeted: only the plugin gatherer runs)
//  + throwOnError surfaces a typed FactError
//
// In-process mock ssh2 Server (algorithms.serverHostKey:['ssh-rsa']) + Bun.serve
// on a fixed high port (39518, distinct from http.test.ts's 39517).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Server, SshConnection } from "../src/transport";
import { HttpApiConnection } from "../src/transport/http";
import { FactsEngine } from "../src/facts";
import { renderArgs, evalWhen, type TemplateVars } from "../src/executor/context";
import { render } from "../src/templating/fast";

const HTTP_PORT = 39518;
const NO_RETRY = { retries: 0, minTimeout: 10, maxTimeout: 50, factor: 2, randomize: false };

function generateKey(dir: string): { pubKeyLine: string; keyPath: string } {
  const keyPath = join(dir, "host_key");
  Bun.spawnSync(["ssh-keygen", "-t", "rsa", "-b", "2048", "-f", keyPath, "-N", "", "-q"]);
  const pubKeyLine = Bun.spawnSync(["ssh-keygen", "-y", "-f", keyPath]).stdout.toString().trim();
  return { pubKeyLine, keyPath };
}

let sshServer: Server;
let sshPort = 0;
let knownHostsPath = "";
let httpServer: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "rolecall-facts-"));
  const { pubKeyLine, keyPath } = generateKey(dir);
  const hostKey = readFileSync(keyPath, "utf-8");
  knownHostsPath = join(dir, "known_hosts");
  writeFileSync(knownHostsPath, `127.0.0.1 ${pubKeyLine}\n`);

  sshServer = new Server(
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
          session.on("exec", (acceptExec, _reject, info) => {
            const stream = acceptExec();
            const cmd = info.command.toString();
            const respond = (out: string): void => {
              stream.write(out);
              stream.exit(0);
              stream.end();
            };
            switch (cmd) {
              case "uname -srm":
                respond("Linux 5.15.0-123-generic x86_64\n");
                break;
              case "cat /etc/os-release":
                respond('ID=ubuntu\nVERSION_ID="22.04"\n');
                break;
              case "hostname":
                respond("web01\n");
                break;
              case "hostname -I":
                respond("10.0.0.5 192.168.1.5\n");
                break;
              case "systemctl is-active ssh":
                respond("active\n");
                break;
              case "cat /etc/timezone":
                respond("UTC\n");
                break;
              default:
                stream.exit(0);
                stream.end();
            }
          });
        });
      });
    },
  );
  await new Promise<void>((resolve) => sshServer.listen(0, "127.0.0.1", () => resolve()));
  sshPort = sshServer.address().port;

  httpServer = Bun.serve({
    port: HTTP_PORT,
    fetch(req) {
      const p = new URL(req.url).pathname;
      if (p === "/status") return new Response("ok", { status: 200 });
      return new Response("not found", { status: 404 });
    },
  });
});

afterAll(() => {
  sshServer?.close();
  httpServer?.stop(true);
});

function sshConn(): SshConnection {
  return new SshConnection({
    kind: "ssh",
    host: "127.0.0.1",
    port: sshPort,
    user: "tester",
    credentials: { password: "pw" },
    knownHostsPath,
    strictHostKeyChecking: true,
    retry: NO_RETRY,
    timeoutMs: 5000,
  });
}

// ---------------------------------------------------------------------------
// (a) gathered facts object has expected subset keys matching the fixture
// ---------------------------------------------------------------------------

test("gatherFacts returns the requested subset of facts from the target", async () => {
  const engine = new FactsEngine();
  const conn = sshConn();
  await conn.connect();
  const facts = await engine.gatherFacts(conn, [
    "os",
    "kernel",
    "arch",
    "os_family",
    "hostname",
    "ip_addresses",
  ]);
  await conn.disconnect();

  expect(facts.os).toBe("Linux");
  expect(facts.kernel).toBe("5.15.0-123-generic");
  expect(facts.arch).toBe("x86_64");
  expect(facts.os_family).toBe("ubuntu");
  expect(facts.hostname).toBe("web01");
  expect(facts.ip_addresses).toEqual(["10.0.0.5", "192.168.1.5"]);
});

test("targeted gather runs only the gatherers needed for the requested keys", async () => {
  const engine = new FactsEngine();
  const conn = sshConn();
  await conn.connect();
  // Only "hostname" is requested -> networkGatherer runs, osGatherer must NOT.
  const facts = await engine.gatherFacts(conn, ["hostname"]);
  await conn.disconnect();

  expect(facts.hostname).toBe("web01");
  expect(facts.os).toBeUndefined();
  expect(facts.kernel).toBeUndefined();
});

// ---------------------------------------------------------------------------
// (b) repeated gather returns the cached copy (same reference)
// ---------------------------------------------------------------------------

test("repeated gather for same host+keys returns the cached object (same reference)", async () => {
  const engine = new FactsEngine();
  const conn = sshConn();
  await conn.connect();

  const t0 = Date.now();
  const first = await engine.gatherFacts(conn, ["os", "hostname"]);
  const firstElapsed = Date.now() - t0;

  const t1 = Date.now();
  const second = await engine.gatherFacts(conn, ["os", "hostname"]);
  const secondElapsed = Date.now() - t1;

  await conn.disconnect();

  expect(second).toBe(first); // identical reference => cache hit, no re-gather
  // Cache hit should be dramatically cheaper than the first (real) gather.
  expect(secondElapsed).toBeLessThan(firstElapsed);
});

test("force:true bypasses the cache and returns a fresh object", async () => {
  const engine = new FactsEngine();
  const conn = sshConn();
  await conn.connect();
  const first = await engine.gatherFacts(conn, ["os"]);
  const forced = await engine.gatherFacts(conn, ["os"], { force: true });
  await conn.disconnect();

  expect(forced).not.toBe(first);
  expect(forced.os).toBe(first.os);
});

// ---------------------------------------------------------------------------
// (c) facts available in a subsequent task render (exposed under `facts.*`)
// ---------------------------------------------------------------------------

test("facts expose under the `facts` namespace and merge with `vars` in a render context", async () => {
  const engine = new FactsEngine();
  const conn = sshConn();
  await conn.connect();
  const facts = await engine.gatherFacts(conn, ["os", "hostname", "arch"]);
  await conn.disconnect();

  // Mirror the executor's buildVars 9-namespace shape (ADR 0013): facts live under
  // `facts`, base vars under `vars`, and `host` moves to `play.host`.
  const vars: TemplateVars = {
    vars: { app: "nginx" },
    facts,
    reg: {},
    loop: {},
    play: { host: "web01", hosts: ["web01"], groups: [], roles: [], path: undefined },
    inv: { hosts: {}, groups: {}, defaults: {} },
    role: {},
    run: { id: "local", started_at: "", epoch: 0 },
    rolecall: { version: "0.0.0", runtime: "bun", ansible_compat: false },
  };

  // Fact access through the EJS renderer (fast.ts). Eta-style `<%= %>` delimiters
  // (not Jinja `{{ }}`). Facts are namespaced under `facts`.
  expect(
    render("Host <%= facts.hostname %> runs <%= facts.os %> (<%= facts.arch %>)", vars as unknown as Record<string, unknown>),
  ).toBe("Host web01 runs Linux (x86_64)");
  // Base vars preserved under the `vars` namespace.
  expect(render("app=<%= vars.app %>", vars as unknown as Record<string, unknown>)).toBe("app=nginx");
  const args = renderArgs({ msg: { $template: "deploy to <%= facts.hostname %>" } }, vars);
  expect(args.msg).toBe("deploy to web01");
  expect(evalWhen({ $eq: [{ $var: "vars.app" }, "nginx"] }, vars)).toBe(true);
  expect(evalWhen({ $eq: [{ $var: "vars.app" }, "wrong" ] }, vars)).toBe(false);
});

// ---------------------------------------------------------------------------
// (d) unreachable host -> graceful partial, other hosts still gathered
// ---------------------------------------------------------------------------

test("unreachable host yields a graceful partial while other hosts are gathered", async () => {
  const engine = new FactsEngine();

  const good = sshConn();
  await good.connect();
  const goodFacts = await engine.gatherFacts(good, ["os", "hostname"]);
  await good.disconnect();

  // Never connected -> exec rejects with "not connected" -> gatherer skipped.
  const bad = new SshConnection({
    kind: "ssh",
    host: "down.invalid",
    port: 1,
    user: "u",
    credentials: { password: "x" },
    retry: NO_RETRY,
    timeoutMs: 2000,
  });
  const badFacts = await engine.gatherFacts(bad, ["os", "hostname"]);

  expect(goodFacts.os).toBe("Linux");
  expect(goodFacts.hostname).toBe("web01");
  expect(Object.keys(badFacts)).toEqual([]); // graceful empty, no throw
});

test("throwOnError surfaces a typed FactError the caller can catch", async () => {
  const engine = new FactsEngine();
  const bad = new SshConnection({
    kind: "ssh",
    host: "down.invalid",
    port: 1,
    user: "u",
    credentials: { password: "x" },
    retry: NO_RETRY,
    timeoutMs: 2000,
  });
  await expect(
    engine.gatherFacts(bad, ["os"], { throwOnError: true }),
  ).rejects.toThrowError(/fact gatherer/);
});

// ---------------------------------------------------------------------------
// custom FactPlugin (targeted: only the plugin gatherer runs)
// ---------------------------------------------------------------------------

test("custom FactPlugin adds a gatherer used only when its key is requested", async () => {
  const engine = new FactsEngine({
    plugins: [
      {
        name: "tz",
        gatherers: [
          {
            name: "timezone",
            provides: ["timezone"],
            async gather(conn) {
              const r = await conn.exec("cat /etc/timezone");
              return { timezone: r.stdout.trim() };
            },
          },
        ],
      },
    ],
  });

  const conn = sshConn();
  await conn.connect();
  const facts = await engine.gatherFacts(conn, ["timezone"]);
  await conn.disconnect();

  expect(facts.timezone).toBe("UTC");
  // Only the plugin gatherer ran; built-in keys are absent (targeted).
  expect(facts.os).toBeUndefined();
});

// ---------------------------------------------------------------------------
// HTTP target: service/state fact via health()
// ---------------------------------------------------------------------------

test("service gatherer reports running state for an HTTP target", async () => {
  const engine = new FactsEngine();
  const conn = new HttpApiConnection({
    kind: "http",
    host: "127.0.0.1",
    port: HTTP_PORT,
    user: "api",
    request: { method: "GET", path: "/status" },
    healthPath: "/status",
    retry: NO_RETRY,
  });
  await conn.connect();
  const facts = await engine.gatherFacts(conn, ["service_status"]);
  await conn.disconnect();

  expect(facts.service_status).toBe("running");
});
