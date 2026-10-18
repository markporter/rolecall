// Orchestrator integration test (Task 18 — dual-mode entrypoint / Express API).
//
// Boots the Express orchestrator IN-PROCESS on an ephemeral port and drives REAL
// execution against the Task-17 in-process SIMULATORS (ssh/http/network) via their
// factory exports + transport clients — NO docker/lxc/podman. Exercises every
// required route plus eventual-consistency polling (/run -> /runs/:id/status).
//
// State is sandboxed under temp ROLECALL_HOME/ROLECALL_PROJECT_STATE and an explicit sqlite
// dbPath so nothing touches real home or project dirs.

import { afterEach, afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";

import { openStore } from "../../src/store";
import { createServer, type ServerHandle } from "../../src/orchestrator";
import { createHttpSim, createSshSim, createNetworkDeviceSim } from "../../src/testing/sims";
import type { JobBody, TargetDescriptor } from "../../src/orchestrator";

const TMP_ROOT = mkdtempSync(join(tmpdir(), "rolecall-orchestrator-it-"));
const DB_PATH = join(TMP_ROOT, "state.db");
let HOME_BACKUP: string | undefined;
let PROJECT_STATE_BACKUP: string | undefined;

beforeAll(() => {
  // Sandbox all registry/env state per the inherited convention.
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

let handle: ServerHandle;
let sshApi: ReturnType<typeof createSshSim>;
let httpApi: ReturnType<typeof createHttpSim>;
let netApi: ReturnType<typeof createNetworkDeviceSim>;

async function boot(): Promise<void> {
  sshApi = await createSshSim({ port: 0, execHandlers: { "echo hello": "hello\n", "uname -srm": "Linux 5.15.0-123-generic x86_64\n" } });
  httpApi = await createHttpSim({
    port: 0,
    routes: {
      "GET /ping": () => ({ ok: true }),
      "POST /echo": async (_r, ctx) => JSON.parse(await ctx.text()),
    },
  });
  netApi = await createNetworkDeviceSim({ port: 0, initialRunning: "hostname sw1\n" });

  const fleet: TargetDescriptor[] = [
    { name: "web1", kind: "ssh", host: sshApi.host, port: sshApi.port, user: sshApi.user, credentials: { privateKey: readFileSync(sshApi.privateKeyPath, "utf-8") } },
    { name: "api1", kind: "http", url: httpApi.baseUrl },
    { name: "sw1", kind: "network", device: netApi },
  ];

  const store = openStore({ dbPath: DB_PATH });
  handle = await createServer({ port: 0, hostname: "127.0.0.1", store, fleet, noSignalHandlers: true });
}

/** Poll GET /runs/:id/status until predicate holds or timeout elapses. */
async function waitForRun(runId: string, pred: (status: unknown) => boolean, opts: { timeoutMs?: number; intervalMs?: number } = {}): Promise<any> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const intervalMs = opts.intervalMs ?? 15;
  const start = Date.now();
  for (;;) {
    const res = await fetch(`${handle.baseUrl}/runs/${runId}/status`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    if (pred(body)) return body;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for run ${runId} (${JSON.stringify(body)})`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function postRun(body: JobBody): Promise<{ runId: string; status: string }> {
  const res = await fetch(`${handle.baseUrl}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  expect([200, 202]).toContain(res.status);
  return (await res.json()) as { runId: string; status: string };
}

beforeAll(async () => { await boot(); });
afterAll(async () => { try { handle?.store?.close(); } catch { /* ignore */ } });

// --- liveness ---------------------------------------------------------------

test("GET /health and friends respond 200 JSON", async () => {
  for (const p of ["/", "/health", "/ping", "/status"]) {
    const res = await fetch(`${handle.baseUrl}${p}`);
    expect(res.status).toBe(200);
    const j = await res.json() as any;
    expect(j.service).toBe("rolecall");
    expect(j.status).toBe("ok");
  }
});

test("POST /run returns a stable runId; polling reaches success (eventual consistency)", async () => {
  // ad-hoc ping over the REAL SSH simulator transport client.
  const r1 = await postRun({ type: "adhoc", targets: ["web1"], module: "ping" });
  expect(typeof r1.runId).toBe("string");
  expect(r1.runId.length).toBeGreaterThan(0);
  const done1 = await waitForRun(r1.runId, (b: any) => b.status === "success" || b.status === "failed");
  expect(done1.status).toBe("success");
  expect(done1.outcomes[0].host).toBe("web1");
  expect(done1.outcomes[0].ok).toBe(true);

  // HTTP echo round-trip against the in-process HTTP endpoint.
  const r2 = await postRun({ type: "adhoc", targets: ["api1"], module: "command", args: { route: "POST /echo", payload: { msg: "hi" } } });
  const done2 = await waitForRun(r2.runId, (b: any) => b.status === "success" || b.status === "failed");
  expect(done2.status).toBe("success");
  expect(done2.outcomes[0].detail.response.msg).toBe("hi");
});

test("playbook across mixed transports reuses config loaders + inventory engine", async () => {
  // Write real YAML files so src/config/loader (loadPlaybookFile/loadInventoryFile)
  // AND src/inventory/engine.resolveTargets are exercised end-to-end.
  const dir = join(TMP_ROOT, "manifests");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "site.yml"), [
    "---",
    "- hosts: all",
    "  tasks:",
    "    - name: check",
    "      module: ping",
    "",
  ].join("\n"));
  writeFileSync(join(dir, "inventory.yml"), [
    "---",
    "groups:",
    "  web:",
    "    hosts: [web1]",
    "  api:",
    "    hosts: [api1]",
    "  net:",
    "    hosts: [sw1]",
    "",
  ].join("\n"));

  const r = await postRun({ type: "playbook", playbookPath: join(dir, "site.yml"), inventoryPath: join(dir, "inventory.yml") });
  const done = await waitForRun(r.runId, (b: any) => b.status === "success" || b.status === "failed");
  expect(done.status).toBe("success");
  const hosts = done.outcomes.map((o: any) => o.host).sort();
  expect(hosts).toEqual(["api1", "sw1", "web1"]); // deterministic sorted resolution
  expect(done.dispatchCount).toBe(3);
});

test("non-idempotent fire-and-forget applies on every identical re-run", async () => {
  const body: JobBody = { type: "nonIdempotent", targets: ["sw1"], module: "set_config", config: "hostname sw2\ninterface Gi0/1\ndescription new\n" };

  const r1 = await postRun(body);
  const d1 = await waitForRun(r1.runId, (b: any) => b.status === "success" || b.status === "failed");
  expect(d1.status).toBe("success");
  expect(d1.outcomes[0].changed).toBe(true); // fresh apply
  expect(netApi.getState().running).toContain("sw2"); // real device mutation

  // Identical second dispatch — must ALSO apply (not skip), proving fire-and-forget.
  const r2 = await postRun(body);
  const d2 = await waitForRun(r2.runId, (b: any) => b.status === "success" || b.status === "failed");
  expect(r2.runId).not.toBe(r1.runId); // distinct stable ids
  expect(d2.status).toBe("success");
  expect(d2.outcomes[0].changed).toBe(true); // forced applied despite no diff
  expect(d2.dispatchCount).toBe(1);
});

// --- error surfaces ---------------------------------------------------------

test("unknown route -> 404 JSON; known path + wrong method -> 405 JSON", async () => {
  const notFound = await fetch(`${handle.baseUrl}/nope`);
  expect(notFound.status).toBe(404);
  expect(Object.prototype.hasOwnProperty.call(await notFound.json(), "error")).toBe(true);

  const badMethod = await fetch(`${handle.baseUrl}/health`, { method: "POST" });
  expect(badMethod.status).toBe(405);
  expect(Object.prototype.hasOwnProperty.call(await badMethod.json(), "error")).toBe(true);

  // Wrong method on a parametric route too.
  const r = (await postRun({ type: "adhoc", targets: ["web1"], module: "ping" })).runId;
  const p = await fetch(`${handle.baseUrl}/runs/${r}/status`, { method: "POST" });
  expect(p.status).toBe(405);
});

test("invalid job type is rejected with 400 (no crash)", async () => {
  const res = await fetch(`${handle.baseUrl}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "bogus" }) });
  expect(res.status).toBe(400);
  expect(Object.prototype.hasOwnProperty.call(await res.json(), "error")).toBe(true);
});

test("unknown run id -> 404 JSON", async () => {
  const res = await fetch(`${handle.baseUrl}/runs/does-not-exist/status`);
  expect(res.status).toBe(404);
});

// --- projects CRUD (persisted via Task-19 store) ----------------------------

test("projects CRUD round-trips through the durable store", async () => {
  const create = await fetch(`${handle.baseUrl}/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "/srv/web1", vars: { replicas: 3 } }) });
  expect(create.status).toBe(201);
  const proj = (await create.json()) as { id: string };
  expect(proj.id).toBeTruthy();

  const listBefore = (await (await fetch(`${handle.baseUrl}/projects`)).json()) as unknown[];
  expect(listBefore.length).toBeGreaterThan(0);

  const upd = await fetch(`${handle.baseUrl}/projects/${proj.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ vars: { replicas: 5 } }) });
  expect(upd.status).toBe(200);
  expect(((await upd.json()) as any).vars.replicas).toBe(5);

  const del = await fetch(`${handle.baseUrl}/projects/${proj.id}`, { method: "DELETE" });
  expect(del.status).toBe(200);
  expect((await del.json()).deleted).toBe(true);

  const after = (await (await fetch(`${handle.baseUrl}/projects`)).json()) as Array<{ id: string }>;
  expect(after.find((p) => p.id === proj.id)).toBeUndefined();
});

// --- schedule management ----------------------------------------------------

test("schedules minimal create/list/cancel", async () => {
  const created = await fetch(`${handle.baseUrl}/schedules`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "nightly", cronSpec: "0 2 * * *", actionType: "playbook", params: { playbook: "site.yml" } }) });
  expect(created.status).toBe(201);
  const sched = (await created.json()) as { id: string };

  const list = (await (await fetch(`${handle.baseUrl}/schedules`)).json()) as Array<{ name: string }>;
  expect(list.some((s) => s.name === "nightly")).toBe(true);

  const cancel = await fetch(`${handle.baseUrl}/schedules/${sched.id}`, { method: "DELETE" });
  expect(cancel.status).toBe(200);
  expect((await cancel.json()).cancelled).toBe(true);
});
