// Todo 20 — cron parser + deterministic scheduler (Bun-native `bun:test`).
//
// Covers: (a) nextOccurrence snapshot math incl. lists/ranges/steps/Vixie OR;
// (b) malformed specs throw with the offending expr in the message; (c) arming
// persists + reschedule advances store.nextRunAt; (d) firing enqueues and yields
// a retrievable runId through a real Engine against a network sim; (e) disabling
// stops later fires; (f) non-idempotent actions re-run every simulated tick.

import { afterEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openStore } from "../src/store";
import type { Store } from "../src/store";
import { CronScheduler, isValid, nextOccurrence, parseExpr } from "../src/orchestrator";
import { Engine } from "../src/orchestrator";
import type { JobBody } from "../src/orchestrator";
import { createNetworkDeviceSim } from "../src/testing/sims";
import type { Enqueuer } from "../src/orchestrator";

interface Created { dbPath: string; store: Store }

const created: Created[] = [];
afterEach(() => {
  for (const c of created.splice(0)) { try { c.store.close(); } catch { /* ignore */ } }
});

function fresh(): Store {
  const dbPath = join(mkdtempSync(join(tmpdir(), "rolecall-sched-")), "state.db");
  const store = openStore({ dbPath });
  created.push({ dbPath, store });
  return store;
}

const delay = (ms = 25) => new Promise((r) => setTimeout(r, ms));

function iso(y: number, mo: number, d: number, h: number, mi: number): Date {
  return new Date(Date.UTC(y, mo - 1, d, h, mi, 0, 0));
}

class Recorder implements Enqueuer {
  bodies: JobBody[] = [];
  enqueue(body: JobBody): string { this.bodies.push(body); return "rid-" + this.bodies.length; }
}


// --- (a) nextOccurrence snapshot cases --------------------------------------

test("nextOccurrence: daily at 09:00", () => {
  expect(nextOccurrence(iso(2024, 1, 1, 0, 0), "0 9 * * *").getTime()).toBe(iso(2024, 1, 1, 9, 0).getTime());
});

test("nextOccurrence: strictly greater than an exact fire instant", () => {
  // After exactly 09:00, the next fire must be tomorrow, not the same instant.
  expect(nextOccurrence(iso(2024, 1, 1, 9, 0), "0 9 * * *").getTime()).toBe(iso(2024, 1, 2, 9, 0).getTime());
});

test("nextOccurrence: step minutes */15", () => {
  expect(nextOccurrence(iso(2024, 1, 1, 0, 7), "*/15 * * * *").getTime()).toBe(iso(2024, 1, 1, 0, 15).getTime());
  expect(nextOccurrence(iso(2024, 1, 1, 0, 15), "*/15 * * * *").getTime()).toBe(iso(2024, 1, 1, 0, 30).getTime());
});

test("nextOccurrence: first of month at midnight", () => {
  expect(nextOccurrence(iso(2024, 3, 15, 10, 0), "0 0 1 * *").getTime()).toBe(iso(2024, 4, 1, 0, 0).getTime());
});

test("nextOccurrence: specific day-of-month/month (crosses year boundary)", () => {
  expect(nextOccurrence(iso(2024, 10, 1, 0, 0), "30 4 13 10 *").getTime()).toBe(iso(2024, 10, 13, 4, 30).getTime());
  expect(nextOccurrence(iso(2024, 10, 20, 0, 0), "30 4 13 10 *").getTime()).toBe(iso(2025, 10, 13, 4, 30).getTime());
});

test("nextOccurrence: weekday-only Sunday", () => {
  // 2024-01-01 is a Monday; the next Sunday is 2024-01-07.
  expect(nextOccurrence(iso(2024, 1, 1, 0, 0), "0 0 * * 0").getTime()).toBe(iso(2024, 1, 7, 0, 0).getTime());
});

test("nextOccurrence: dow 7 behaves like 0 (Sunday)", () => {
  expect(parseExpr("0 0 * * 7")).toBeDefined();
  expect(nextOccurrence(iso(2024, 1, 1, 0, 0), "0 0 * * 7").getTime()).toBe(iso(2024, 1, 7, 0, 0).getTime());
});

test("nextOccurrence: list/range/step combos on hours and days", () => {
  // Business hours Mon-Fri; after Saturday noon -> Monday 09:00.
  expect(nextOccurrence(iso(2024, 1, 6, 12, 0), "0 9-17 * * 1-5").getTime()).toBe(iso(2024, 1, 8, 9, 0).getTime());
  // Mid-week advance to the next whole business hour.
  expect(nextOccurrence(iso(2024, 1, 8, 10, 30), "0 9-17 * * 1-5").getTime()).toBe(iso(2024, 1, 8, 11, 0).getTime());
  // Weekend-only 02:10; after Tuesday -> Saturday.
  expect(nextOccurrence(iso(2024, 1, 2, 0, 0), "10 2 * * 0,6").getTime()).toBe(iso(2024, 1, 6, 2, 10).getTime());
  // Step on day-of-month: every 10th starting at 1 -> {1,11,21}.
  expect(nextOccurrence(iso(2024, 1, 1, 0, 1), "0 0 */10 * *").getTime()).toBe(iso(2024, 1, 11, 0, 0).getTime());
});

test("nextOccurrence: Vixie OR semantics when both DOM and DOW are restricted", () => {
  // Friday OR the 13th — either condition fires. Every returned candidate must
  // satisfy one of them.
  const expr = "0 0 13 * 5";
  const c = parseExpr(expr);
  for (const after of [iso(2024, 10, 1, 0, 0), iso(2024, 4, 1, 0, 0), iso(2024, 2, 1, 0, 0)]) {
    const t = nextOccurrence(after, expr);
    expect(t.getUTCHours()).toBe(0);
    expect(c.dom.has(t.getUTCDate()) || c.dowNormalized.has(t.getUTCDay())).toBe(true);
    expect(t.getTime()).toBeGreaterThan(after.getTime());
  }
});

// --- (b) malformed specs ----------------------------------------------------

const MALFORMED = ["", "* * * *", "* * * * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * 32 * *", "* * * 0 *", "* * * 13 *", "* * * * 8", "*/0 * * * *", "5-1 * * * *", "a * * * *"];

for (const spec of MALFORMED) {
  test(`malformed cron rejected: ${JSON.stringify(spec)}`, () => {
    expect(isValid(spec)).toBe(false);
    let msg = "";
    try {
      parseExpr(spec);
    } catch (err) {
      msg = err instanceof Error ? err.message : String(err);
    }
    expect(msg.startsWith(`invalid cron expression "${spec}"`)).toBe(true);
    if (spec !== "") expect(msg).toContain(spec);
  });
}

test("malformed rejection surfaces in the message with the offending expr", () => {
  let msg = "";
  try {
    parseExpr("* * 99 * *");
  } catch (err) {
    msg = err instanceof Error ? err.message : String(err);
  }
  expect(msg.startsWith(`invalid cron expression "* * 99 * *"`)).toBe(true);
  expect(msg).toContain("'99'");
  expect(msg).toContain("out of range");
});

// --- (c) arming + reschedule updates store.nextRunAt ------------------------

test("construction arms enabled schedules and persists nextRunAt from the cron math", async () => {
  const store = fresh();
  const sched = await store.schedules.create({ name: "daily", cronSpec: "0 9 * * *", actionType: "adhoc", params: {}, enabled: true });
  expect(sched.nextRunAt).toBeUndefined();

  const rec = new Recorder();
  const s = new CronScheduler({ repo: store.schedules, engine: rec });
  await s.runOnce();

  const row = await store.schedules.get(sched.id);
  expect(row?.nextRunAt).toBeDefined();
  const expected = nextOccurrence(new Date(), "0 9 * * *").getTime();
  expect(row!.nextRunAt!).toBeGreaterThan(expected - 61_000);
  expect(row!.nextRunAt!).toBeLessThan(expected + 5_000);
  expect(rec.bodies.length).toBe(0); // future fire not yet due
  s.stop();
});

test("firing advances store.nextRunAt to a strictly later instant", async () => {
  const store = fresh();
  const sched = await store.schedules.create({ name: "every-min", cronSpec: "* * * * *", actionType: "adhoc", params: {}, enabled: true, nextRunAt: Date.now() - 1 });
  const rec = new Recorder();
  const s = new CronScheduler({ repo: store.schedules, engine: rec });

  await s.runOnce(); // first fire
  const r1 = await store.schedules.get(sched.id);
  expect(r1?.lastRunAt).toBeGreaterThan(0);
  expect(r1?.nextRunAt).toBeGreaterThan(Date.now());

  await s.runOnce(); // still armed but now scheduled into the future -> no re-fire
  expect(rec.bodies.length).toBe(1);

  await store.schedules.update(sched.id, { nextRunAt: Date.now() - 1 });
  await s.runOnce(); // forced-due second tick
  const r2 = await store.schedules.get(sched.id);
  expect(rec.bodies.length).toBe(2);
  expect(r2?.lastRunAt).toBeGreaterThanOrEqual(r1?.lastRunAt);
  s.stop();
});

test("schedule without a persisted nextRunAt gets one computed on arm", async () => {
  const store = fresh();
  const sched = await store.schedules.create({ name: "no-next", cronSpec: "30 4 13 10 *", actionType: "playbook", params: {}, enabled: true });
  const rec = new Recorder();
  const s = new CronScheduler({ repo: store.schedules, engine: rec });
  await s.runOnce();
  const row = await store.schedules.get(sched.id);
  expect(row?.nextRunAt).toBe(nextOccurrence(new Date(), "30 4 13 10 *").getTime());
  s.stop();
});

// --- body construction defaults --------------------------------------------

test("body defaults module to ping when unspecified; spreads params + uses actionType as type", async () => {
  const store = fresh();
  await store.schedules.create({ name: "adhoc-ping", cronSpec: "* * * * *", actionType: "adhoc", params: { targets: ["web1"] }, enabled: true, nextRunAt: Date.now() - 1 });
  await store.schedules.create({ name: "nonidem", cronSpec: "* * * * *", actionType: "nonIdempotent", params: { targets: ["sw1"], config: "hostname x\n" }, enabled: true, nextRunAt: Date.now() - 1 });
  const rec = new Recorder();
  const s = new CronScheduler({ repo: store.schedules, engine: rec });
  await s.runOnce();

  const adhoc = rec.bodies.find((b) => b.type === "adhoc");
  expect(adhoc?.module).toBe("ping");
  expect(adhoc?.targets).toEqual(["web1"]);

  const nonidempotent = rec.bodies.find((b) => b.type === "nonIdempotent");
  expect(nonidempotent?.config).toBe("hostname x\n");
  expect(nonidempotent?.module).toBe("ping");
  s.stop();
});

// --- trigger() --------------------------------------------------------------

test("trigger enqueues immediately and honours an explicit job type", async () => {
  const store = fresh();
  const rec = new Recorder();
  const s = new CronScheduler({ repo: store.schedules, engine: rec });
  expect(await s.trigger({ type: "playbook", targets: ["a"] })).toBe(true);
  expect(await s.trigger({ module: "command" })).toBe(true); // defaults to 'adhoc'
  expect(rec.bodies[0].type).toBe("playbook");
  expect(rec.bodies[1].type).toBe("adhoc");
  s.stop();
});

// --- (d) firing through a real Engine returns a retrievable runId -----------

test("fired runs execute targets and return a retrievable runId via the Engine", async () => {
  const store = fresh();
  const dev = await createNetworkDeviceSim({ port: 0, initialRunning: "hostname sw1\n" });
  const engine = new Engine(store, [{ name: "sw1", kind: "network", device: dev }]);
  await store.projects.create({ path: "/srv/sched" });

  const sched = await store.schedules.create({
    name: "cfg-push", cronSpec: "* * * * *", actionType: "nonIdempotent",
    params: { targets: ["sw1"], module: "set_config", config: "hostname sw2\n" },
    enabled: true, nextRunAt: Date.now() - 1,
  });

  const s = new CronScheduler({ repo: store.schedules, engine });
  await s.runOnce();
  await delay(60);

  const records = engine.list();
  expect(records).toHaveLength(1);
  const rec = records[0]!;
  expect(typeof rec.id).toBe("string");
  expect(engine.get(rec.id)).toBeDefined();
  expect(["success", "running"]).toContain(rec.status);
  expect(rec.dispatchCount).toBe(1);
  expect(rec.outcomes.map((o) => o.host)).toContain("sw1");
  expect(dev.getState().running).toContain("sw2");

  let found = false;
  for (let i = 0; i < 80 && !found; i++) {
    if ((await store.runs.list()).some((r) => r.id === rec.id)) found = true;
    else await delay(10);
  }
  expect(found).toBe(true);
  s.stop();
});

// --- (e) disable stops subsequent fires -------------------------------------

test("disabling a schedule stops later fires; re-enabling resumes them", async () => {
  const store = fresh();
  const sched = await store.schedules.create({ name: "toggle", cronSpec: "* * * * *", actionType: "adhoc", params: {}, enabled: true, nextRunAt: Date.now() - 1 });
  const rec = new Recorder();
  const s = new CronScheduler({ repo: store.schedules, engine: rec });

  await s.runOnce();
  expect(rec.bodies.length).toBe(1);

  await store.schedules.setEnabled(sched.id, false);
  await s.runOnce(); // disabled -> skipped even though armed
  expect(rec.bodies.length).toBe(1);

  await store.schedules.setEnabled(sched.id, true);
  await store.schedules.update(sched.id, { nextRunAt: Date.now() - 1 }); // force due on resume
  await s.runOnce(); // re-arm + fire
  expect(rec.bodies.length).toBe(2);
  s.stop();
});

test("cancelling (deleting) a schedule stops its fires", async () => {
  const store = fresh();
  const sched = await store.schedules.create({ name: "gone", cronSpec: "* * * * *", actionType: "adhoc", params: {}, enabled: true, nextRunAt: Date.now() - 1 });
  const rec = new Recorder();
  const s = new CronScheduler({ repo: store.schedules, engine: rec });
  await s.runOnce();
  expect(rec.bodies.length).toBe(1);

  await store.schedules.delete(sched.id);
  await s.runOnce();
  expect(rec.bodies.length).toBe(1);
  s.stop();
});

// --- malformed scheduling is skipped, never crashes -------------------------

test("malformed cron specs are skipped at arm time and never fire", async () => {
  const store = fresh();
  await store.schedules.create({ name: "bad", cronSpec: "not-a-cron", actionType: "adhoc", params: {}, enabled: true, nextRunAt: Date.now() - 1 });
  const rec = new Recorder();
  const s = new CronScheduler({ repo: store.schedules, engine: rec });
  await s.runOnce();
  expect(rec.bodies.length).toBe(0);
  s.stop();
});

// --- stop() idempotency -----------------------------------------------------

test("stop() halts the automatic firing loop and is safe to call twice", async () => {
  const store = fresh();
  await store.schedules.create({ name: "x", cronSpec: "* * * * *", actionType: "adhoc", params: {}, enabled: true, nextRunAt: Date.now() - 1 });
  const rec = new Recorder();
  const s = new CronScheduler({ repo: store.schedules, engine: rec, tickMs: 8 });
  await s.start();
  await delay(45);
  const n1 = rec.bodies.length;
  expect(n1).toBeGreaterThan(0);

  s.stop();
  s.stop(); // idempotent — must neither throw nor re-arm
  await delay(45);
  expect(rec.bodies.length).toBe(n1); // automatic loop stopped firing
});
