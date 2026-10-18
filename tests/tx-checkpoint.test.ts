// Transaction + checkpoint engine tests (Todo 26). Bun-primary (`bun:test`).
//
// Exercises the genuine ledger + undo engine over RoleCall's planning-scaffold executor:
//   (a) a tx spanning two plays rolls back applied members on a later failure
//       (reversible modules are undone in reverse ledger order);
//   (b) plays with different / no tx ids are independent (rollback is scoped);
//   (c) `--resume` skips tasks already applied at/after the checkpoint;
//   (d) a non-reversible module in a tx is excluded from auto-rollback and surfaced
//       in the pending report;
//   (e) partial rollback preserves the last reached checkpoint (and stopBeforeCheckpoint);
//   (f) toAppliedDelta / parseResumeArg edge cases;
//   (g) TracesRepository.listByTx / listByRunCheckpoint against real sqlite.

import { afterEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RunTrace, ModuleContext } from "../src/store/types";
import { openStore } from "../src/store";
import { createNoopConnection } from "../src/executor/context";
import {
  rollbackTransaction,
  computeResumeSkipSet,
  parseResumeArg,
  toAppliedDelta,
  type AnyModule,
  type AppliedDelta,
  type Module,
} from "../src/executor/tx";
import { registerModule } from "../src/executor/module";

function scratch(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `rolecall-tx-${prefix}-`));
}

function trace(p: Partial<RunTrace> & Pick<RunTrace, "id" | "runId" | "taskName" | "phase" | "status" | "seq">): RunTrace {
  return {
    host: "",
    iteration: -1,
    startedAt: 0,
    endedAt: null,
    durationMs: null,
    detail: {},
    ...p,
  } as RunTrace;
}

function undoable(name: string): Module {
  return {
    name,
    async run() {
      return { changed: true };
    },
    async undo() {
      return { changed: true };
    },
  };
}

function plain(name: string): Module {
  return {
    name,
    async run() {
      return { changed: true };
    },
  };
}

function mods(map: Record<string, Module | null>): (n: string) => AnyModule {
  return (n: string) => (map[n] ?? undefined);
}

function buildCtx(d: AppliedDelta): ModuleContext {
  return {
    host: d.host,
    connection: createNoopConnection(d.host),
    args: {},
    vars: {},
    facts: {},
    registered: {},
  };
}

afterEach(() => {
  delete process.env.ROLECALL_HOME;
  delete process.env.ROLECALL_PROJECT_STATE;
});

test("(a) tx across two plays rolls back applied members in reverse order", async () => {
  const ledger: RunTrace[] = [
    trace({ id: "1", runId: "r", taskName: "playA-t1", phase: "end", status: "ok", seq: 1, txId: "tx1", detail: { module: "file" } }),
    trace({ id: "2", runId: "r", taskName: "playA-t2", phase: "end", status: "ok", seq: 2, txId: "tx1", detail: { module: "file" } }),
    trace({ id: "3", runId: "r", taskName: "playB-t3", phase: "end", status: "ok", seq: 3, txId: "tx1", detail: { module: "file" } }),
    trace({ id: "4", runId: "r", taskName: "playB-t4", phase: "end", status: "failed", seq: 4, txId: "tx1", detail: { module: "file" } }),
  ];

  const res = await rollbackTransaction({
    txId: "tx1",
    ledger,
    getModule: mods({ file: undoable("file") }),
    buildContext: buildCtx,
  });

  expect(res.undone.map((u) => u.taskName)).toEqual(["playB-t3", "playA-t2", "playA-t1"]);
  expect(res.undone.every((u) => u.ok)).toBe(true);
  expect(res.pending).toHaveLength(0);
  expect(res.boundarySeq).toBe(Number.NEGATIVE_INFINITY);
});

test("(b) plays with different / no tx are independent on rollback", async () => {
  const ledger: RunTrace[] = [
    trace({ id: "1", runId: "r", taskName: "a1", phase: "end", status: "ok", seq: 1, txId: "tx1", detail: { module: "file" } }),
    trace({ id: "2", runId: "r", taskName: "a2", phase: "end", status: "ok", seq: 2, txId: "tx1", detail: { module: "file" } }),
    trace({ id: "3", runId: "r", taskName: "b1", phase: "end", status: "ok", seq: 3, txId: "tx2", detail: { module: "file" } }),
    trace({ id: "4", runId: "r", taskName: "indep", phase: "end", status: "ok", seq: 4, detail: { module: "file" } }),
  ];

  const res = await rollbackTransaction({
    txId: "tx1",
    ledger,
    getModule: mods({ file: undoable("file") }),
    buildContext: buildCtx,
  });
  expect(res.undone.map((u) => u.taskName)).toEqual(["a2", "a1"]);
  expect(res.undone.find((u) => u.taskName === "b1")).toBeUndefined();
  expect(res.undone.find((u) => u.taskName === "indep")).toBeUndefined();
});

test("(c) resume from checkpoint skips applied taskNames at/after it", () => {
  const ledger: RunTrace[] = [
    trace({ id: "1", runId: "r", taskName: "t1", phase: "end", status: "ok", seq: 1, txId: "tx1", checkpointId: "cp1", detail: { module: "file" } }),
    trace({ id: "2", runId: "r", taskName: "t2", phase: "end", status: "ok", seq: 2, txId: "tx1", checkpointId: "cp1", detail: { module: "file" } }),
    trace({ id: "3", runId: "r", taskName: "t3", phase: "end", status: "ok", seq: 3, txId: "tx1", checkpointId: "cp2", detail: { module: "file" } }),
    trace({ id: "4", runId: "r", taskName: "t4", phase: "end", status: "ok", seq: 4, txId: "tx1", checkpointId: "cp2", detail: { module: "file" } }),
  ];
  const skip = computeResumeSkipSet(ledger, "r", "cp1");
  expect([...skip].sort()).toEqual(["t2", "t3", "t4"]);
  expect(skip.has("t1")).toBe(false);
  expect(computeResumeSkipSet(ledger, "r", "nope").size).toBe(4);
});

test("(d) non-reversible module excluded from rollback and reported as pending", async () => {
  const ledger: RunTrace[] = [
    trace({ id: "1", runId: "r", taskName: "deploy-config", phase: "end", status: "ok", seq: 1, txId: "tx1", detail: { module: "file" } }),
    trace({ id: "2", runId: "r", taskName: "seed-db", phase: "end", status: "ok", seq: 2, txId: "tx1", detail: { module: "shell" } }),
  ];

  const res = await rollbackTransaction({
    txId: "tx1",
    ledger,
    getModule: mods({ file: undoable("file"), shell: plain("shell") }),
    buildContext: buildCtx,
  });
  expect(res.undone.map((u) => u.taskName)).toEqual(["deploy-config"]);
  expect(res.pending).toHaveLength(1);
  expect(res.pending[0]!.task).toBe("seed-db");
  expect(res.pending[0]!.module).toBe("shell");
  expect(res.pending[0]!.reason).toMatch(/non-reversible/);
});

test("(e) partial rollback preserves last checkpoint; stopBeforeCheckpoint overrides", async () => {
  const ledger: RunTrace[] = [
    trace({ id: "1", runId: "r", taskName: "c1", phase: "end", status: "ok", seq: 1, txId: "tx1", checkpointId: "cp1", detail: { module: "file" } }),
    trace({ id: "2", runId: "r", taskName: "c2", phase: "end", status: "ok", seq: 2, txId: "tx1", checkpointId: "cp1", detail: { module: "file" } }),
    trace({ id: "3", runId: "r", taskName: "d1", phase: "end", status: "ok", seq: 3, txId: "tx1", detail: { module: "file" } }),
    trace({ id: "4", runId: "r", taskName: "d2", phase: "end", status: "ok", seq: 4, txId: "tx1", detail: { module: "file" } }),
  ];

  const res = await rollbackTransaction({
    txId: "tx1",
    ledger,
    getModule: mods({ file: undoable("file") }),
    buildContext: buildCtx,
  });
  expect(res.boundarySeq).toBe(2);
  expect(res.undone.map((u) => u.taskName)).toEqual(["d2", "d1"]);

  const full = await rollbackTransaction({
    txId: "tx1",
    ledger,
    getModule: mods({ file: undoable("file") }),
    buildContext: buildCtx,
    stopBeforeCheckpoint: "missing",
  });
  expect(full.undone.map((u) => u.taskName)).toEqual(["d2", "d1", "c2", "c1"]);
});

test("(f) toAppliedDelta and parseResumeArg handle edge cases", () => {
  const noTx = trace({ id: "z", runId: "r", taskName: "t", phase: "end", status: "ok", seq: 9 });
  expect(toAppliedDelta(noTx)).toBeNull();
  const start = trace({ id: "z2", runId: "r", taskName: "t", phase: "start", status: "running", seq: 10, txId: "tx1" });
  expect(toAppliedDelta(start)).toBeNull();
  const ok = trace({ id: "z3", runId: "r", taskName: "t", phase: "end", status: "ok", seq: 11, txId: "tx1", detail: { module: "file" } });
  const d = toAppliedDelta(ok);
  expect(d?.txId).toBe("tx1");
  expect(d?.module).toBe("file");

  // --resume requires the <run_id>:<checkpoint> shape; a missing colon is rejected.
  expect(parseResumeArg("run9:cp3")).toEqual({ runId: "run9", checkpoint: "cp3" });
  expect(parseResumeArg("only-run")).toBeNull();
  expect(parseResumeArg(undefined)).toBeNull();
  expect(parseResumeArg("")).toBeNull();
});

test("(g) TracesRepository listByTx and listByRunCheckpoint query correctly", async () => {
  const store = openStore({ dbPath: join(scratch("repo"), "state.db") });
  await store.traces.create({ runId: "r1", taskName: "t", phase: "end", status: "ok", txId: "txA", checkpointId: "cp1" });
  await store.traces.create({ runId: "r1", taskName: "t2", phase: "end", status: "ok", txId: "txA", checkpointId: "cp2" });
  await store.traces.create({ runId: "r1", taskName: "t3", phase: "end", status: "ok", txId: "txB" });
  await store.traces.create({ runId: "r1", taskName: "t4", phase: "end", status: "ok" });

  const byTx = await store.traces.listByTx("txA");
  expect(byTx).toHaveLength(2);
  expect(byTx.every((t) => t.txId === "txA")).toBe(true);

  const byCp = await store.traces.listByRunCheckpoint("r1", "cp1");
  expect(byCp).toHaveLength(1);
  expect(byCp[0]!.checkpointId).toBe("cp1");

  expect(await store.traces.listByTx("nope")).toHaveLength(0);
  store.close();
});

test("(h) rollback resolves modules via the FQCN resolver when getModule is omitted", async () => {
  const name = "tx_test_undoable";
  registerModule(undoable(name));
  const ledger: RunTrace[] = [
    trace({ id: "1", runId: "r", taskName: "t1", phase: "end", status: "ok", seq: 1, txId: "tx1", detail: { module: name } }),
  ];
  const res = await rollbackTransaction({ txId: "tx1", ledger, buildContext: buildCtx });
  expect(res.undone.map((u) => u.taskName)).toEqual(["t1"]);
  expect(res.pending).toHaveLength(0);
});
