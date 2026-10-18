// Proof test: demonstrates the reusable OFFLINE sim factories are independently
// usable by integration tests WITHOUT the farm running. Exercises real SSH
// round-trips through createSshSim() and real HTTP round-trips through
// createHttpSim(), each on its own ephemeral port (so they never clash with any
// other test file even when run concurrently). No docker/lxc/podman required.
import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SshConnection } from "../../src/transport/ssh";
import { createHttpSim, createSshSim } from "../../src/testing/sims";

const closed: Array<{ close(): void }> = [];
afterEach(() => {
  for (const c of closed.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
});

test("createSshSim: pubkey connect + exec/facts/host-key accept, plus health()", async () => {
  const ssh = await createSshSim({
    // ephemeral: OS assigns a free port; reported back via .port/.health().
    port: 0,
    execHandlers: {
      "echo hello": "hello\n",
      "uname -srm": "Linux 5.15.0-123-generic x86_64\n",
    },
  });
  closed.push(ssh);

  expect(typeof ssh.port).toBe("number");
  const conn = new SshConnection({
    kind: "ssh",
    host: ssh.host,
    port: ssh.port,
    user: ssh.user,
    credentials: { privateKey: readFileSync(ssh.privateKeyPath, "utf-8") },
    knownHostsPath: ssh.knownHostsPath,
    strictHostKeyChecking: true,
    retry: { retries: 0, minTimeout: 10, maxTimeout: 50, factor: 2, randomize: false },
    timeoutMs: 10000,
  });
  await conn.connect();
  try {
    const res = await conn.exec("echo hello");
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe("hello");

    const facts = await conn.facts();
    expect(facts.transport).toBe("ssh");
    expect(facts.os).toMatch(/Linux/);
  } finally {
    await conn.disconnect();
  }

  // Liveness probe resolves true against the scripted server.
  expect(await ssh.health()).toBe(true);
});

test("createHttpSim: GET/POST/PATCH round-trip + snapshot capture", async () => {
  const http = await createHttpSim({
    routes: {
      "GET /ping": () => ({ pong: true }),
      "POST /echo": async (_r, ctx) => JSON.parse(await ctx.text()),
      "PATCH /whoami": (_r, ctx) => ({ authorization: ctx.authorization }),
    },
  });
  closed.push(http);

  let res = await fetch(`${http.baseUrl}/ping`);
  expect(res.status).toBe(200);
  expect((await res.json()).pong).toBe(true);

  res = await fetch(`${http.baseUrl}/echo`, { method: "POST", body: JSON.stringify({ name: "rolecall" }) });
  expect((await res.json()).name).toBe("rolecall");

  res = await fetch(`${http.baseUrl}/whoami`, { method: "PATCH", headers: { Authorization: "Bearer abc" } });
  expect((await res.json()).authorization).toBe("Bearer abc");
  expect(http.lastRequest()?.authorization).toBe("Bearer abc");
  expect(http.lastRequest()?.method).toBe("PATCH");

  expect(await http.health()).toBe(true);
});

test("createHttpSim: enforces basic/token auth injection", async () => {
  const secured = await createHttpSim({
    auth: { type: "token", token: "secret-tok" },
    routes: { "GET /me": () => ({ ok: true }) },
  });
  closed.push(secured);

  const unauth = await fetch(`${secured.baseUrl}/me`);
  expect(unauth.status).toBe(401);

  const authed = await fetch(`${secured.baseUrl}/me`, { headers: { Authorization: "Bearer secret-tok" } });
  expect(authed.status).toBe(200);
  expect((await authed.json()).ok).toBe(true);
});
