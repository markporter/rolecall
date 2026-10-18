// Execution-trace ledger tests (Todo 25). Bun-primary (`bun:test`).
//
// Covers: (a) traces repository round-trips + per-run seq ordering, (b) the
// executor emits start/end trace rows with populated duration_ms, (c) run replay
// re-emits a stored ledger + per-host profile aggregation, (d) computeProfile
// aggregates per-host wall-clock timing + failure counts.

import { afterEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../src/store";
import type { RunTrace } from "../src/store/types";
import { runPlaybook } from "../src/executor";
import type { NormalizedInventory, NormalizedPlaybook, NormalizedTask } from "../src/config/schema";
import { computeProfile, makeTraceSink, runReplayCommand } from "../src/cli/commands/run";
import { CliError } from "../src/cli/types";

function scratch(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `rolecall-trace-${prefix}-`));
}

function inventory(hosts: string[]): NormalizedInventory {
  return { groups: { all: { hosts, vars: {} } } };
}

function mkTask(p: Omit<NormalizedTask, "notify"> & { notify?: string[] }): NormalizedTask {
  return { notify: [], ...p };
}

afterEach(() => {
  delete process.env.ROLECALL_HOME;
  delete process.env.ROLECALL_PROJECT_STATE;
});

// (a) repository round-trip + monotonic per-run seq.
test("(a) traces persist, list by run in seq order, and update", async () => {
  const dbPath = join(scratch("repo"), "state.db");
  const store = openStore({ dbPath });

  const start = await store.traces.create({
    runId: "r1",
    taskName: "t",
    phase: "start",
    status: "running",
  });
  const end = await store.traces.create({
    runId: "r1",
    host: "h1",
    taskName: "t",
    phase: "end",
    status: "ok",
    startedAt: 1000,
    endedAt: 1005,
    durationMs: 5,
  });

  // seq is assigned per-run and strictly increasing.
  expect(end.seq).toBeGreaterThan(start.seq);

  const list = await store.traces.listByRun("r1");
  expect(list).toHaveLength(2);
  // Ordered by ascending seq (replay order).
  expect(list[0]!.id).toBe(start.id);
  expect(list[1]!.id).toBe(end.id);
  expect(list[1]!.durationMs).toBe(5);

  const updated = await store.traces.update(start.id, {
    status: "ok",
    endedAt: 1001,
    durationMs: 1,
  });
  expect(updated?.status).toBe("ok");
  expect(updated?.durationMs).toBe(1);

  // A different run is isolated.
  await store.traces.create({ runId: "r2", taskName: "other", phase: "start", status: "running" });
  expect(await store.traces.listByRun("r1")).toHaveLength(2);
  expect(await store.traces.listByRun("r2")).toHaveLength(1);

  store.close();
});

// (b) executor emits start/end traces with populated duration_ms.
test("(b) runTaskOnHost emits trace rows with duration_ms populated", async () => {
  const traces: RunTrace[] = [];
  const pb: NormalizedPlaybook = {
    hosts: ["all"],
    tasks: [
      mkTask({ name: "ok-task", module: "debug", args: { x: "1" } }),
      mkTask({ name: "skip-task", module: "debug", args: {}, when: false }),
    ],
    vars: {},
  };
  const res = await runPlaybook([pb], inventory(["h1", "h2"]), {
    runId: "run-x",
    trace: (t) => traces.push(t),
  });

  expect(res.ok).toBe(4);
  // Every emitted trace is tagged with the run id.
  expect(traces.every((t) => t.runId === "run-x")).toBe(true);
  // Each host gets a start + end for the running task.
  const ends = traces.filter((t) => t.phase === "end");
  expect(ends.length).toBeGreaterThanOrEqual(2);
  expect(ends.every((t) => t.durationMs !== null)).toBe(true);
  // Host coverage spans both targets.
  expect(new Set(traces.map((t) => t.host))).toEqual(new Set(["h1", "h2"]));
  // The when:false task records a when-eval skipped phase on each host iteration.
  expect(traces.some((t) => t.phase === "when-eval" && t.status === "skipped")).toBe(true);
});

// (c) replay re-emits a stored ledger and aggregates per-host profile.
test("(c) run replay re-emits traces and aggregates per-host profile", async () => {
  // Sandbox the global registry so runReplayCommand's openStore() resolves to the
  // same database the ledger was written to.
  const home = scratch("replay");
  process.env.ROLECALL_HOME = home;
  const store = openStore();
  const run = await store.runs.create({ actionType: "replay-test", status: "success", payload: {} });
  const sink = makeTraceSink(store, run.id);
  sink({ id: "x", runId: run.id, host: "h1", taskName: "t", iteration: -1, phase: "end", status: "ok", startedAt: 1, endedAt: 2, durationMs: 10, detail: {}, seq: 0 });
  sink({ id: "y", runId: run.id, host: "h2", taskName: "t", iteration: -1, phase: "end", status: "failed", startedAt: 1, endedAt: 2, durationMs: 20, detail: {}, seq: 0 });
  // makeTraceSink persists fire-and-forget; let the shared write queue drain before closing.
  await new Promise((r) => setTimeout(r, 40));
  store.close();

  const result = (await runReplayCommand("replay", [run.id], {
    limit: undefined,
    force: false,
    check: false,
    diff: false,
    output: "json",
    trace: false,
    profile: false,
  })) as unknown as { found: boolean; traces: RunTrace[]; profile: Record<string, { tasks: number; totalMs: number; failed: number }> };

  expect(result.found).toBe(true);
  expect(result.traces).toHaveLength(2);
  expect(result.profile["h1"]!.totalMs).toBe(10);
  expect(result.profile["h1"]!.failed).toBe(0);
  expect(result.profile["h2"]!.totalMs).toBe(20);
  expect(result.profile["h2"]!.failed).toBe(1);

  // Unknown id still re-emits any trace ledger (found=false) without throwing.
  const missing = (await runReplayCommand("replay", ["nope"], {
    limit: undefined,
    force: false,
    check: false,
    diff: false,
    output: "json",
    trace: false,
    profile: false,
  })) as unknown as { found: boolean };
  expect(missing.found).toBe(false);

  // Wrong subcommand is a usage error.
  expect(runReplayCommand("bogus", [], {} as never)).rejects.toBeInstanceOf(CliError);
});

// (d) computeProfile aggregates per-host timing + failures.
test("(d) computeProfile aggregates per-host wall-clock + failures", () => {
  const profile = computeProfile([
    { id: "1", runId: "r", host: "h1", taskName: "t", iteration: -1, phase: "start", status: "running", startedAt: 0, endedAt: null, durationMs: null, detail: {}, seq: 1 },
    { id: "2", runId: "r", host: "h1", taskName: "t", iteration: -1, phase: "end", status: "ok", startedAt: 0, endedAt: 5, durationMs: 5, detail: {}, seq: 2 },
    { id: "3", runId: "r", host: "h1", taskName: "t2", iteration: -1, phase: "end", status: "failed", startedAt: 0, endedAt: 9, durationMs: 4, detail: {}, seq: 3 },
    { id: "4", runId: "r", host: "h2", taskName: "t", iteration: -1, phase: "end", status: "ok", startedAt: 0, endedAt: 3, durationMs: 3, detail: {}, seq: 4 },
  ]);
  expect(profile["h1"]).toEqual({ tasks: 2, totalMs: 9, failed: 1 });
  expect(profile["h2"]).toEqual({ tasks: 1, totalMs: 3, failed: 0 });
});
