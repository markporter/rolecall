// Clientless REST agent surface tests (Task 28).
//
// (a) GET /mcp returns valid JSON-schema tool specs covering the 8 mapped tools.
// (b) `rolecall agent manifest` emits the SAME spec (CLI parity via the shared generator).
// (c) An external agent (stock HTTP) drives a real check -> apply -> replay cycle
//     through the in-process orchestrator (no MCP SDK, no LLM loop).
// (d) Schema-invalid agent input fails CLOSED with a named-field error (400 + path).
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createServer, type ServerHandle, type TargetDescriptor } from "../src/orchestrator";
import { openStore } from "../src/store";
import { createHttpSim, createSshSim, createNetworkDeviceSim } from "../src/testing/sims";
import { runAgentCommand } from "../src/cli/commands/agent";
import { renderOutput } from "../src/cli/output";
import type { GlobalFlags } from "../src/cli/types";

const TMP_ROOT = mkdtempSync(join(tmpdir(), "rolecall-mcp-it-"));
let HOME_BACKUP: string | undefined;
let PROJECT_STATE_BACKUP: string | undefined;
let DB_SEQ = 0;
function nextDb(): string { return join(TMP_ROOT, `state-${DB_SEQ++}.db`); }

const HANDLES: ServerHandle[] = [];

const FLAGS: GlobalFlags = {
  limit: undefined,
  force: false,
  check: false,
  diff: false,
  forks: undefined,
  output: "json",
  inventory: undefined,
  trace: false,
  profile: false,
  resume: undefined,
};

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

afterAll(async () => {
  for (const h of HANDLES) {
    try { h.closeDrain(); } catch { /* best-effort */ }
  }
});

async function boot(): Promise<ServerHandle> {
  const ssh = await createSshSim({ port: 0, execHandlers: { "echo hello": "hello\n", "uname -srm": "Linux 5.15.0-123-generic x86_64\n" } });
  const http = await createHttpSim({ port: 0, routes: { "GET /ping": () => ({ ok: true }), "POST /echo": async (_r, ctx) => JSON.parse(await ctx.text()) } });
  const net = await createNetworkDeviceSim({ port: 0, initialRunning: "hostname sw1\n" });
  const fleet: TargetDescriptor[] = [
    { name: "web1", kind: "ssh", host: ssh.host, port: ssh.port, user: ssh.user, credentials: { privateKey: readFileSync(ssh.privateKeyPath, "utf-8") } },
    { name: "api1", kind: "http", url: http.baseUrl },
    { name: "sw1", kind: "network", device: net },
  ];
  const store = openStore({ dbPath: nextDb() });
  const handle = await createServer({ port: 0, hostname: "127.0.0.1", store, fleet, noSignalHandlers: true });
  HANDLES.push(handle);
  return handle;
}

function callRaw(url: string, init: RequestInit): Promise<{ status: number; json: any }> {
  return fetch(url, init).then(async (res) => ({ status: res.status, json: await res.json().catch(() => null) }));
}

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

const EXPECTED_TOOLS = [
  "facts.gather",
  "playbook.run",
  "playbook.diff",
  "run.replay",
  "modules.search",
  "docs.search",
  "inventory.show",
  "run.status",
];

// (a) GET /mcp returns valid JSON-schema tool specs covering the 8 mapped tools.
test("GET /mcp returns the 8 mapped tool specs with JSON-schema inputSchema", async () => {
  const handle = await boot();
  const res = await callRaw(handle.baseUrl + "/mcp", { method: "GET" });
  expect(res.status).toBe(200);
  expect(res.json.transport).toBe("http");
  expect(Array.isArray(res.json.tools)).toBe(true);
  const names = res.json.tools.map((t: any) => t.name).sort();
  expect(names).toEqual([...EXPECTED_TOOLS].sort());
  for (const tool of res.json.tools) {
    expect(typeof tool.description).toBe("string");
    expect(tool.inputSchema).toBeDefined();
    expect(tool.inputSchema.type).toBe("object");
    expect(typeof tool.rest.method).toBe("string");
    expect(typeof tool.rest.path).toBe("string");
    expect(Array.isArray(tool.rest.params)).toBe(true);
  }
  const byName = Object.fromEntries(res.json.tools.map((t: any) => [t.name, t]));
  expect(byName["playbook.run"].rest.method).toBe("POST");
  expect(byName["playbook.run"].rest.path).toBe("/run");
  expect(byName["playbook.diff"].rest.method).toBe("POST");
  expect(byName["playbook.diff"].rest.path).toBe("/run");
  expect(byName["run.replay"].rest.method).toBe("GET");
  expect(byName["run.replay"].rest.path).toBe("/runs/:id/trace");
  expect(byName["run.replay"].rest.related?.[0]?.path).toBe("/runs/:id/profile");
  expect(byName["modules.search"].rest.method).toBe("GET");
  expect(byName["modules.search"].rest.path).toBe("/modules");
  expect(byName["docs.search"].rest.method).toBe("GET");
  expect(byName["docs.search"].rest.path).toBe("/mcp/docs");
  expect(byName["inventory.show"].rest.method).toBe("GET");
  expect(byName["inventory.show"].rest.path).toBe("/inventory");
  expect(byName["run.status"].rest.method).toBe("GET");
  expect(byName["run.status"].rest.path).toBe("/runs/:id/status");
  expect(byName["facts.gather"].rest.method).toBe("POST");
  expect(byName["facts.gather"].rest.path).toBe("/facts");
});

// (b) `rolecall agent manifest` emits the SAME spec (shares the generator module).
test("rolecall agent manifest emits the same spec as GET /mcp", async () => {
  const handle = await boot();
  const res = await callRaw(handle.baseUrl + "/mcp", { method: "GET" });
  const serverManifest = res.json;

  const cliResult = await runAgentCommand("manifest", [], FLAGS);
  expect(cliResult.command).toBe("agent manifest");
  const cliJson = JSON.parse(renderOutput("json", cliResult));
  expect(cliJson).toEqual(serverManifest);

  const cliHuman = renderOutput("human_summary", cliResult);
  expect(JSON.parse(cliHuman)).toEqual(serverManifest);
});

// (c) External agent drives a real check -> apply -> replay cycle over stock HTTP.
test("agent drives check -> apply -> replay via REST", async () => {
  const handle = await boot();

  const checkRes = await callRaw(handle.baseUrl + "/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "adhoc", module: "ping", targets: ["web1"], check: true }),
  });
  expect(checkRes.status).toBe(202);
  expect(typeof checkRes.json.runId).toBe("string");
  const checkId = checkRes.json.runId as string;
  await poll(handle.baseUrl, checkId);

  const applyRes = await callRaw(handle.baseUrl + "/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "adhoc", module: "ping", targets: ["web1"] }),
  });
  expect(applyRes.status).toBe(202);
  const applyId = applyRes.json.runId as string;
  await poll(handle.baseUrl, applyId);

  const trace = await callRaw(`${handle.baseUrl}/runs/${applyId}/trace`, { method: "GET" });
  expect(trace.status).toBe(200);
  expect(trace.json.runId).toBe(applyId);
  const profile = await callRaw(`${handle.baseUrl}/runs/${applyId}/profile`, { method: "GET" });
  expect(profile.status).toBe(200);
  expect(profile.json.runId).toBe(applyId);

  const status = await callRaw(`${handle.baseUrl}/runs/${applyId}/status`, { method: "GET" });
  expect(status.status).toBe(200);
  expect(status.json.status).toBe("success");
});

// (d) Schema-invalid agent input fails CLOSED with a named-field error.
test("POST /run rejects invalid agent input with field-path errors", async () => {
  const handle = await boot();

  const badType = await callRaw(handle.baseUrl + "/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "not-a-type" }),
  });
  expect(badType.status).toBe(400);
  expect(Array.isArray(badType.json.fieldErrors)).toBe(true);
  expect(badType.json.fieldErrors.some((f: any) => f.path === "type")).toBe(true);

  const noModule = await callRaw(handle.baseUrl + "/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "adhoc" }),
  });
  expect(noModule.status).toBe(400);
  expect(noModule.json.fieldErrors.some((f: any) => f.path === "module")).toBe(true);

  const empty = await callRaw(handle.baseUrl + "/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(empty.status).toBe(400);
  expect(Array.isArray(empty.json.fieldErrors)).toBe(true);
  expect(empty.json.fieldErrors.some((f: any) => f.path === "type")).toBe(true);

  const badFacts = await callRaw(handle.baseUrl + "/facts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ not: "an inventory" }),
  });
  expect(badFacts.status).toBe(400);
  expect(badFacts.json.fieldErrors.some((f: any) => f.path === "inventory")).toBe(true);
});

// modules.search surfaces idempotency metadata over REST (agent surface).
test("GET /modules?q= returns module summaries with idempotency metadata", async () => {
  const handle = await boot();
  const res = await callRaw(handle.baseUrl + "/modules?q=", { method: "GET" });
  expect(res.status).toBe(200);
  expect(Array.isArray(res.json.modules)).toBe(true);
  for (const m of res.json.modules) {
    expect(typeof m.name).toBe("string");
  }
  const filtered = await callRaw(handle.baseUrl + "/modules?q=debug", { method: "GET" });
  expect(filtered.status).toBe(200);
  expect(filtered.json.modules.every((m: any) => (m.name + (m.description ?? "")).toLowerCase().includes("debug"))).toBe(true);
});
