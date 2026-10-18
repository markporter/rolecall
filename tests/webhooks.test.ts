// Webhook & REST run-trigger tests (Todo 21). Run under `bun test`.
//
// Boots the Express orchestrator IN-PROCESS on ephemeral ports and drives REAL
// execution through Engine.enqueue against Task-17 sims (ssh/http/network), exactly
// like tests/integration/orchestrator.integration.test.ts. Covers:
//   (a) valid webhook payload -> dispatched run returns a stable id retrievable via
//       GET /runs/:id/status reaching success (playbook/adhoc/nonIdempotent types);
//   (b) invalid / unknown / missing type -> 400 JSON that executes NOTHING (run count
//       stays unchanged, proving validation precedes dispatch);
//   (c) optional Bearer guard -> 401 without/wrong token, 202 when authorized, and OPEN
//       when no token is configured.
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createServer, type ServerHandle, type TargetDescriptor } from "../src/orchestrator";
import { openStore } from "../src/store";
import { createHttpSim, createSshSim, createNetworkDeviceSim } from "../src/testing/sims";

const TMP_ROOT = mkdtempSync(join(tmpdir(), "rolecall-webhook-it-"));
const NL = String.fromCharCode(10); // newline without embedding an escape in this source
let HOME_BACKUP: string | undefined;
let PROJECT_STATE_BACKUP: string | undefined;
let DB_SEQ = 0;
function nextDb(): string { return join(TMP_ROOT, `state-${DB_SEQ++}.db`); }

const HANDLES: ServerHandle[] = [];

beforeAll(() => {
  HOME_BACKUP = process.env.ROLECALL_HOME;
  PROJECT_STATE_BACKUP = process.env.ROLECALL_PROJECT_STATE;
  process.env.ROLECALL_HOME = TMP_ROOT;
  process.env.ROLECALL_PROJECT_STATE = TMP_ROOT;
});

afterEach(() => {
  delete process.env.ROLECALL_HOME;
  delete process.env.ROLECALL_PROJECT_STATE;
  if (HOME_BACKUP !== undefined) process.env.ROLECALL_HOME = HOME_BACKUP;
  if (PROJECT_STATE_BACKUP !== undefined) process.env.ROLECALL_PROJECT_STATE = PROJECT_STATE_BACKUP;
});

async function boot(opts?: { authToken?: string }): Promise<{ handle: ServerHandle; net: ReturnType<typeof createNetworkDeviceSim> }> {
  const ssh = await createSshSim({ port: 0, execHandlers: { "echo hello": "hello\n", "uname -srm": "Linux 5.15.0-123-generic x86_64\n" } });
  const http = await createHttpSim({ port: 0, routes: { "GET /ping": () => ({ ok: true }), "POST /echo": async (_r, ctx) => JSON.parse(await ctx.text()) } });
  const net = await createNetworkDeviceSim({ port: 0, initialRunning: "hostname sw1\n" });
  const fleet: TargetDescriptor[] = [
    { name: "web1", kind: "ssh", host: ssh.host, port: ssh.port, user: ssh.user, credentials: { privateKey: readFileSync(ssh.privateKeyPath, "utf-8") } },
    { name: "api1", kind: "http", url: http.baseUrl },
    { name: "sw1", kind: "network", device: net },
  ];
  const store = openStore({ dbPath: nextDb() });
  const handle = await createServer({ port: 0, hostname: "127.0.0.1", store, fleet, noSignalHandlers: true, authToken: opts?.authToken });
  HANDLES.push(handle);
  return { handle, net };
}

/** Poll GET /runs/:id/status until terminal or timeout. */
async function poll(baseUrl: string, runId: string): Promise<any> {
  const start = Date.now();
  for (;;) {
    const res = await fetch(`${baseUrl}/runs/${runId}/status`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    if (body.status === "success" || body.status === "failed") return body;
    if (Date.now() - start > 8000) throw new Error(`timed out waiting for ${runId}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

function callRaw(url: string, init: RequestInit): Promise<{ status: number; json: any }> {
  return fetch(url, init).then(async (res) => ({ status: res.status, json: await res.json().catch(() => null) }));
}

function webhook(baseUrl: string, body: unknown, authHeader?: string): Promise<{ status: number; json: any }> {
  return callRaw(baseUrl + "/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...(authHeader ? { authorization: authHeader } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// --- (a) valid payloads dispatch through the SAME enqueue path --------------

test("POST /webhook adhoc ping over SSH returns a stable id reachable via /runs/:id/status", async () => {
  const { handle } = await boot();
  const r = await webhook(handle.baseUrl, { type: "adhoc", targets: ["web1"], module: "ping" });
  expect(r.status).toBe(202);
  expect(typeof r.json.runId).toBe("string");
  expect(r.json.runId.length).toBeGreaterThan(0);
  expect(r.json.status).toBe("queued");
  expect(r.json.type).toBe("adhoc");
  expect(r.json.self).toBe(`/runs/${r.json.runId}/status`);
  const done = await poll(handle.baseUrl, r.json.runId);
  expect(done.status).toBe("success");
  expect(done.outcomes[0].host).toBe("web1");
  expect(done.outcomes[0].ok).toBe(true);
});

test("POST /webhook non-idempotent applies on every re-run and mutates the real device", async () => {
  const { handle, net } = await boot();
  const cfg = ["hostname sw2", "interface Gi0/1", "description new"].join(NL);
  const body = { type: "nonIdempotent", targets: ["sw1"], module: "set_config", config: cfg };
  const first = await webhook(handle.baseUrl, body);
  expect(first.status).toBe(202);
  const d1 = await poll(handle.baseUrl, first.json.runId);
  expect(d1.status).toBe("success");
  expect(d1.outcomes[0].changed).toBe(true); // force applied (non-idempotent bypasses check)
  expect(net.getState().running).toContain("sw2"); // dispatched against the live simulator
  const second = await webhook(handle.baseUrl, body);
  expect(second.json.runId).not.toBe(first.json.runId); // distinct stable ids
  const d2 = await poll(handle.baseUrl, second.json.runId);
  expect(d2.outcomes[0].changed).toBe(true); // forced applied despite identical state
  expect(d2.dispatchCount).toBe(1);
});

test("POST /webhook playbook across inventory resolves all hosts end-to-end", async () => {
  const { handle } = await boot();
  const dir = join(TMP_ROOT, "manifests");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "site.yml"), ["---", "- hosts: all", "  tasks:", "    - name: check", "      module: ping", ""].join("\n"));
  writeFileSync(join(dir, "inventory.yml"), ["---", "groups:", "  web:", "    hosts: [web1]", "  api:", "    hosts: [api1]", "  net:", "    hosts: [sw1]", ""].join("\n"));
  const r = await webhook(handle.baseUrl, { type: "playbook", playbookPath: join(dir, "site.yml"), inventoryPath: join(dir, "inventory.yml") });
  expect(r.status).toBe(202);
  const done = await poll(handle.baseUrl, r.json.runId);
  expect(done.status).toBe("success");
  expect(done.outcomes.map((o: any) => o.host).sort()).toEqual(["api1", "sw1", "web1"]);
  expect(done.dispatchCount).toBe(3);
});

// --- (b) invalid payload rejected BEFORE any execution ----------------------

test("invalid / missing / malformed / incomplete types are 400 with zero executions", async () => {
  const { handle } = await boot();
  const baseline = handle.listRuns().length;

  const bogus = await webhook(handle.baseUrl, { type: "bogus" });
  expect(bogus.status).toBe(400);
  expect(typeof bogus.json.error).toBe("string");
  expect(handle.listRuns().length).toBe(baseline);

  const missingType = await webhook(handle.baseUrl, { targets: ["web1"] });
  expect(missingType.status).toBe(400);
  expect(handle.listRuns().length).toBe(baseline);

  const notObject = await webhook(handle.baseUrl, "[1,2,3]");
  expect(notObject.status).toBe(400);
  expect(handle.listRuns().length).toBe(baseline);

  const incomplete = await webhook(handle.baseUrl, { type: "nonIdempotent", targets: ["sw1"] });
  expect(incomplete.status).toBe(400);
  expect(handle.listRuns().length).toBe(baseline);
});

// --- auth placeholder -------------------------------------------------------

test("Bearer guard rejects unauthenticated + wrong-token requests then accepts the right token", async () => {
  const { handle } = await boot({ authToken: "whsec-todo21" });
  const before = handle.listRuns().length;

  const noAuth = await webhook(handle.baseUrl, { type: "adhoc", targets: ["web1"], module: "ping" });
  expect(noAuth.status).toBe(401);
  expect(handle.listRuns().length).toBe(before);

  const wrongToken = await webhook(handle.baseUrl, { type: "adhoc", targets: ["web1"], module: "ping" }, "Bearer nope");
  expect(wrongToken.status).toBe(401);
  expect(handle.listRuns().length).toBe(before);

  const ok = await webhook(handle.baseUrl, { type: "adhoc", targets: ["web1"], module: "ping" }, "Bearer whsec-todo21");
  expect(ok.status).toBe(202);
  expect(ok.json.type).toBe("adhoc");
  const done = await poll(handle.baseUrl, ok.json.runId);
  expect(done.status).toBe("success");
});

test("with no token configured the trigger endpoint stays open without Authorization", async () => {
  const { handle } = await boot();
  const res = await webhook(handle.baseUrl, { type: "adhoc", targets: ["web1"], module: "ping" });
  expect(res.status).toBe(202);
  const done = await poll(handle.baseUrl, res.json.runId);
  expect(done.status).toBe("success");
});

// --- alias endpoint + method gating -----------------------------------------

test("POST /api/run alias dispatches identically and gates disallowed methods to 405", async () => {
  const { handle } = await boot();
  const r = await callRaw(`${handle.baseUrl}/api/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "adhoc", targets: ["web1"], module: "ping" }),
  });
  expect(r.status).toBe(202);
  expect(r.json.self).toBe(`/runs/${r.json.runId}/status`);
  const done = await poll(handle.baseUrl, r.json.runId);
  expect(done.status).toBe("success");

  const badMethod = await fetch(`${handle.baseUrl}/api/run`, { method: "GET" });
  expect(badMethod.status).toBe(405);
});

test("successful webhook run persists to the durable store under its own id (engine map + store)", async () => {
  const { handle } = await boot();
  try {
    const j = (await webhook(handle.baseUrl, { type: "adhoc", targets: ["api1"], module: "ping" })).json as any;
    expect(typeof j.runId).toBe("string");
    expect(j.runId.length).toBeGreaterThan(0);
    const rows = await handle.store!.runs.list();
    expect(rows.some((r: any) => r.id === j.runId && r.actionType === "adhoc")).toBe(true);
  } finally {
    try { handle.closeDrain(); } catch { /* ignore */ }
    try { handle.store?.close(); } catch { /* ignore */ }
  }
});

afterAll(async () => {
  for (const h of HANDLES) {
    try { h.closeDrain(); } catch { /* already closed */ }
    try { h.store?.close(); } catch { /* already closed */ }
  }
});
