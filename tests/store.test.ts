// Registry / persistence tests (Todo 19). Bun-primary (`bun:test`).
//
// Every test isolates state under temp directories so nothing touches the real
// home or a real project dir. Global registry location is sandboxed via ROLECALL_HOME;
// per-project paths go under `<tmp>/<rand>/.rolecall/`.

import { afterEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore, resolveRegistryPath } from "../src/store";

/** A fresh, empty temp directory used as a root for this test's state. */
function scratch(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `rolecall-store-${prefix}-`));
}

afterEach(() => {
  // Never leak env-driven state into sibling suites.
  delete process.env.ROLECALL_HOME;
  delete process.env.ROLECALL_PROJECT_STATE;
});

// --- Project round-trip -----------------------------------------------------

test("project create/get/list/update/delete persists and reloads exactly", async () => {
  const dbPath = join(scratch("rt"), "state.db");
  const store = openStore({ dbPath });

  const created = await store.projects.create({
    path: "/srv/web",
    inventoryRef: "inventory.yml",
    playbookRef: "site.yml",
    vars: { replicas: 3, features: ["a", "b"] },
    history: [{ op: "init" }],
  });

  // Round-trip equality: what we read back deep-equals what we wrote in.
  expect(await store.projects.get(created.id)).toStrictEqual(created);

  // List reflects creation.
  let list = await store.projects.list();
  expect(list).toHaveLength(1);
  expect(list[0].id).toBe(created.id);

  // Update replaces vars and APPENDS to history (no in-memory map clobbering).
  const updated = await store.projects.update(created.id, {
    vars: { replicas: 5 },
    history: [{ op: "scale" }],
  });
  expect(updated?.vars).toEqual({ replicas: 5 });
  expect(updated?.history).toEqual([{ op: "init" }, { op: "scale" }]);
  expect(updated?.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);

  // Delete removes it and reports success.
  expect(await store.projects.delete(created.id)).toBe(true);
  expect(await store.projects.get(created.id)).toBeNull();
  expect(await store.projects.delete(created.id)).toBe(false);
  expect(await store.projects.list()).toHaveLength(0);

  store.close();

  // Reopen on disk: the persisted row survives the close/reopen boundary.
  const reopened = openStore({ dbPath });
  expect(await reopened.projects.list()).toHaveLength(0);
  reopened.close();
});

test("persisted data reloads deterministically after reopen", async () => {
  const dbPath = join(scratch("reload"), "state.db");
  const first = openStore({ dbPath });
  const rec = await first.projects.create({ path: "/srv/persist", vars: { k: "v" } });
  first.close();

  const second = openStore({ dbPath });
  const reloaded = await second.projects.get(rec.id);
  expect(reloaded).toStrictEqual(rec);
  expect((await second.projects.list())[0].id).toBe(rec.id);
  second.close();
});

// --- Run records ------------------------------------------------------------

test("run record created via trigger is retrievable by id and filterable", async () => {
  const dbPath = join(scratch("runs"), "state.db");
  const store = openStore({ dbPath });
  const proj = await store.projects.create({ path: "/srv/run" });

  const run = await store.runs.create({
    projectId: proj.id,
    actionType: "manual",
    targetIds: ["host-a", "host-b"],
    status: "started",
    payload: { note: "triggered by webhook" },
  });
  expect(run.status).toBe("started");
  expect(await store.runs.get(run.id)).toStrictEqual(run);

  // Advance its lifecycle through the typed patch surface.
  const finished = await store.runs.update(run.id, {
    status: "finished",
    resultSummary: "applied 2 hosts",
    finishedAt: Date.now(),
  });
  expect(finished?.status).toBe("finished");
  expect(finished?.resultSummary).toBe("applied 2 hosts");
  expect(finished!.finishedAt).toBeGreaterThan(0);

  // Filtered listing only returns runs for that project.
  const byProject = await store.runs.list(proj.id);
  expect(byProject.map((r) => r.id)).toContain(run.id);
  expect(byProject.every((r) => r.projectId === proj.id)).toBe(true);

  // Unfiltered listing includes it among all runs.
  const allRuns = await store.runs.list();
  expect(allRuns.some((r) => r.id === run.id)).toBe(true);

  store.close();
});

// --- Schedules --------------------------------------------------------------

test("schedule definitions persist and reload with enabled flag intact", async () => {
  const dbPath = join(scratch("sched"), "state.db");
  const store = openStore({ dbPath });

  const sched = await store.schedules.create({
    name: "nightly reconcile",
    cronSpec: "0 2 * * *",
    actionType: "reconcile",
    params: { projectPath: "/srv/sched" },
    enabled: true,
    nextRunAt: 1_700_000_000_000,
  });
  expect(sched.enabled).toBe(true);
  expect(await store.schedules.get(sched.id)).toStrictEqual(sched);

  // Toggle disabled; persists across a full close/reopen cycle.
  const off = await store.schedules.setEnabled(sched.id, false);
  expect(off?.enabled).toBe(false);
  store.close();

  const reopened = openStore({ dbPath });
  const reloaded = await reopened.schedules.get(sched.id);
  expect(reloaded?.enabled).toBe(false);
  expect(await reopened.schedules.list()).toHaveLength(1);
  reopened.close();
});

// --- Concurrency ------------------------------------------------------------

test("two writers issuing writes close together keep BOTH rows (no lost update)", async () => {
  const n = 8;
  const dbPath = join(scratch("concurrency"), "state.db");
  // Two independent handles over ONE database — models server + worker/webhook.
  const writerA = openStore({ dbPath });
  const writerB = openStore({ dbPath });

  const outs = await Promise.all([
    writerA.projects.create({ path: "/w0", vars: { w: 0 } }),
    writerB.projects.create({ path: "/w1", vars: { w: 1 } }),
    writerA.projects.create({ path: "/w2", vars: { w: 2 } }),
    writerB.projects.create({ path: "/w3", vars: { w: 3 } }),
    writerA.projects.create({ path: "/w4", vars: { w: 4 } }),
    writerB.projects.create({ path: "/w5", vars: { w: 5 } }),
    writerA.projects.create({ path: "/w6", vars: { w: 6 } }),
    writerB.projects.create({ path: "/w7", vars: { w: 7 } }),
  ]);

  writerA.close();
  writerB.close();

  // Every row from both writers survived, uncorrupted.
  const check = openStore({ dbPath });
  const list = await check.projects.list();
  expect(list).toHaveLength(n);
  expect(new Set(list.map((p) => p.path)).size).toBe(n);
  expect(new Set(list.map((p) => p.id)).size).toBe(n);
  for (const out of outs) {
    expect((await check.projects.get(out.id))?.path).toBe(out.path);
  }
  check.close();
});

// --- Registry precedence ----------------------------------------------------

test("per-project state resolves under <projectDir>/.rolecall and is isolated from global ~/.rolecall", async () => {
  const projRoot = scratch("proj");
  const globalHome = scratch("home");
  process.env.ROLECALL_HOME = globalHome; // sandbox the global registry location
  delete process.env.ROLECALL_PROJECT_STATE;

  // Resolution paths follow the documented precedence.
  expect(resolveRegistryPath({ projectDir: projRoot })).toBe(join(projRoot, ".rolecall", "state.db"));
  expect(resolveRegistryPath()).toBe(join(globalHome, ".rolecall", "state.db"));

  // Writing to the LOCAL registry leaves the GLOBAL one empty.
  const local = openStore({ projectDir: projRoot });
  const created = await local.projects.create({ path: "/srv/local-only" });
  local.close();

  const global = openStore();
  expect(await global.projects.list()).toHaveLength(0);
  global.close();

  // The local data round-trips back through its own path.
  const localAgain = openStore({ projectDir: projRoot });
  const again = await localAgain.projects.list();
  expect(again).toHaveLength(1);
  expect(again[0].id).toBe(created.id);
  localAgain.close();
});
