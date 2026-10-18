// Pluggable static-UI serving tests (Todo 23). Run under `bun test`.
//
// Boots REAL Express in-process on ephemeral ports exactly like tests/webhooks.test.ts and
// drives HTTP through global fetch(). Covers:
//   (a) configured+existing dist serves its index.html AND nested assets;
//   (b) a second, distinct dist yields different rendered content;
//   (c) configured-but-missing dist returns deterministic plain-text guidance (HTTP 200), never throws;
//   (d) unset ui.dist preserves today's health-JSON behaviour on GET "/";
//   (e) an existing dist folder lacking index.html falls back to the embedded default SPA.
import { afterEach, afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createServer, type ServerHandle } from "../src/orchestrator";
import type { Store } from "../src/store";
import { guidanceMessage, DEFAULT_INDEX_HTML } from "../src/orchestrator/static-ui";

const TMP_ROOT = mkdtempSync(join(tmpdir(), "rolecall-static-it-"));
let HOME_BACKUP: string | undefined;
let PROJECT_STATE_BACKUP: string | undefined;

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

// Minimal in-memory store: createServer seeds the scheduler off store.schedules.list() at
// construction; none of these routes touch projects/schedules/dispatch, so nothing further is
// needed. Injected rather than openStore() so the suite drives the REAL express stack under
// BOTH runtimes without invoking the deferred Node SQLite PAL (which throws "deferred past MVP").
function memStore(): Store {
  return { schedules: { list: () => [] }, close() {} } as unknown as Store;
}

async function boot(uiDist?: string): Promise<ServerHandle> {
  const handle = await createServer({ port: 0, hostname: "127.0.0.1", store: memStore(), noSignalHandlers: true, uiDist });
  HANDLES.push(handle);
  return handle;
}

/** Create a dist directory holding index.html (+ optional nested asset) and return its path. */
function makeDir(marker: string, opts?: { assetName?: string; assetBody?: string }): string {
  const dir = join(TMP_ROOT, `dist-${marker.replace(/[^a-z]/gi, "")}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), `<!doctype html><title>RoleCall ${marker}</title><h1>${marker}</h1>`);
  if (opts?.assetName && opts?.assetBody) {
    const p = join(dir, opts.assetName);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, opts.assetBody);
  }
  return dir;
}

// --- (d) zero-build mode ---------------------------------------------------

test("GET / stays health JSON when ui.dist is unset (zero build)", async () => {
  const handle = await boot();
  try {
    const res = await fetch(`${handle.baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("application/json");
    const j = await res.json() as { service: string; status: string };
    expect(j.service).toBe("rolecall");
    expect(j.status).toBe("ok");
  } finally {
    try { handle.closeDrain(); } catch { /* ignore */ }
    try { handle.store?.close(); } catch { /* ignore */ }
  }
});

// --- (a) served dir + nested assets ----------------------------------------

test("configured+existing dist serves its index.html at / and nested assets too", async () => {
  const dir = makeDir("#DIST-A", { assetName: "css/style.css", assetBody: ".x{color:red}" });
  const handle = await boot(dir);
  try {
    const home = await fetch(`${handle.baseUrl}/`);
    expect(home.status).toBe(200);
    expect((await home.text())).toContain("#DIST-A");

    const css = await fetch(`${handle.baseUrl}/css/style.css`);
    expect(css.status).toBe(200);
    expect(await css.text()).toBe(".x{color:red}");

    // Resource routes remain reachable behind the static layer (fall-through).
    const health = await fetch(`${handle.baseUrl}/health`);
    expect(health.status).toBe(200);
    expect(((await health.json()) as { service: string }).service).toBe("rolecall");
  } finally {
    try { handle.closeDrain(); } catch { /* ignore */ }
    try { handle.store?.close(); } catch { /* ignore */ }
  }
});

// --- (b) distinct dist yields different content ----------------------------

test("a second distinct dist renders different content than the first", async () => {
  const dirA = makeDir("#DIST-A");
  const dirB = makeDir("#DIST-B");
  const hA = await boot(dirA);
  const hB = await boot(dirB);
  try {
    const bodyA = await (await fetch(`${hA.baseUrl}/`)).text();
    const bodyB = await (await fetch(`${hB.baseUrl}/`)).text();
    expect(bodyA).toContain("#DIST-A");
    expect(bodyB).toContain("#DIST-B");
    expect(bodyA).not.toContain("#DIST-B");
    expect(bodyB).not.toContain("#DIST-A");
    expect(bodyA).not.toBe(bodyB);
  } finally {
    for (const h of [hA, hB]) {
      try { h.closeDrain(); } catch { /* ignore */ }
      try { h.store?.close(); } catch { /* ignore */ }
    }
  }
});

// --- (c) missing dist -> deterministic guidance, never throws --------------

test("configured-but-missing dist returns deterministic guidance over HTTP 200", async () => {
  const missing = join(TMP_ROOT, "nope-does-not-exist");
  const handle = await boot(missing);
  try {
    const res = await fetch(`${handle.baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/plain");
    expect(await res.text()).toBe(guidanceMessage(missing));
    // Router still owns everything else — nothing crashed, fall-through intact.
    expect((await (await fetch(`${handle.baseUrl}/health`)).json()) as any).toMatchObject({ service: "rolecall" });
  } finally {
    try { handle.closeDrain(); } catch { /* ignore */ }
    try { handle.store?.close(); } catch { /* ignore */ }
  }
});

// --- (e) existing dist without index.html falls back to embedded SPA -------

test("existing dist folder lacking index.html serves the embedded default SPA", async () => {
  const dir = join(TMP_ROOT, "dist-empty-spa");
  mkdirSync(dir, { recursive: true }); // present but empty
  const handle = await boot(dir);
  try {
    const res = await fetch(`${handle.baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/html");
    const html = await res.text();
    expect(html).toBe(DEFAULT_INDEX_HTML);
    expect(html).toContain("RoleCall Orchestrator");
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
