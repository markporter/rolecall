// Execution-trace ledger repository (Todo 25). Typed CRUD over `run_traces`.
//
// One row per task/iteration event carrying timing + outcome. Writes funnel through
// the shared single-writer WriteQueue so concurrent servers/workers never interleave
// sqlite mutations. `seq` is assigned per-run as MAX(seq)+1 so a run's rows replay in
// emission order; the read-modify-write is fenced in a BEGIN IMMEDIATE span over the
// runtime-selected PAL SqliteDb (bun:sqlite / node:sqlite), and every value is bound
// positionally — never string-concatenated into SQL.

import { randomUUID } from "node:crypto";
import type { SqliteDb, SqliteRow } from "../pal";
import type { WriteQueue } from "./write-chain";
import { execute, selectAll, selectOne, transactional, type StoreRow } from "./sql";
import type { CreateTraceInput, PatchTrace, RunTrace, TracesRepo } from "./types";

function rowToTrace(row: SqliteRow): RunTrace {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    host: String(row.host ?? ""),
    taskName: String(row.task_name),
    iteration: Number(row.iteration),
    phase: String(row.phase),
    status: String(row.status),
    startedAt: Number(row.started_at),
    endedAt: row.ended_at != null ? Number(row.ended_at) : null,
    durationMs: row.duration_ms != null ? Number(row.duration_ms) : null,
    txId: row.tx_id != null ? String(row.tx_id) : undefined,
    checkpointId: row.checkpoint_id != null ? String(row.checkpoint_id) : undefined,
    detail: typeof row.detail === "string" && row.detail.length > 0 ? JSON.parse(row.detail) : {},
    seq: Number(row.seq),
  };
}

export class TracesRepository implements TracesRepo {
  readonly #db: SqliteDb;
  readonly #writes: WriteQueue;

  /** @param db Runtime-selected synchronous sqlite connection shared with every repository. @param writes Shared single-writer serialization queue owned by StoreImpl. */
  constructor(db: SqliteDb, writes: WriteQueue) {
    this.#db = db;
    this.#writes = writes;
  }

  async create(input: CreateTraceInput): Promise<RunTrace> {
    const now = Date.now();
    const rec = {
      id: input.id ?? randomUUID(),
      runId: input.runId,
      host: input.host ?? "",
      taskName: input.taskName,
      iteration: input.iteration ?? -1,
      phase: input.phase,
      status: input.status,
      startedAt: input.startedAt ?? now,
      endedAt: input.endedAt ?? null,
      durationMs: input.durationMs ?? null,
      txId: input.txId,
      checkpointId: input.checkpointId,
      detail: input.detail ?? {},
    };
    return this.#writes.enqueue(async (): Promise<RunTrace> => {
      return transactional(this.#db, (): RunTrace => {
        // Per-run ordering counter assigned under the lock so no two events collide.
        const seqRow = selectOne<StoreRow>(this.#db, "SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM run_traces WHERE run_id = ?", [rec.runId]);
        const seq = input.seq ?? (seqRow != null ? Number(seqRow.seq) : 1);
        execute(
          this.#db,
          "INSERT INTO run_traces (id, run_id, host, task_name, iteration, phase, status, started_at, ended_at, duration_ms, tx_id, checkpoint_id, detail, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [rec.id, rec.runId, rec.host, rec.taskName, rec.iteration, rec.phase, rec.status, rec.startedAt, rec.endedAt, rec.durationMs, rec.txId ?? null, rec.checkpointId ?? null, JSON.stringify(rec.detail), seq],
        );
        const row = selectOne<StoreRow>(this.#db, "SELECT * FROM run_traces WHERE id = ?", [rec.id]);
        return row ? rowToTrace(row) : (rec as unknown as RunTrace);
      });
    });
  }

  async get(id: string): Promise<RunTrace | null> {
    const row = selectOne<StoreRow>(this.#db, "SELECT * FROM run_traces WHERE id = ?", [id]);
    return row ? rowToTrace(row) : null;
  }

  async listByRun(runId: string): Promise<RunTrace[]> {
    const rows = selectAll<StoreRow>(this.#db, "SELECT * FROM run_traces WHERE run_id = ? ORDER BY seq ASC, id ASC", [runId]);
    return rows.map((r) => rowToTrace(r));
  }

  async listByTx(txId: string): Promise<RunTrace[]> {
    const rows = selectAll<StoreRow>(this.#db, "SELECT * FROM run_traces WHERE tx_id = ? ORDER BY seq DESC, id DESC", [txId]);
    return rows.map((r) => rowToTrace(r));
  }

  async listByRunCheckpoint(runId: string, checkpointId: string): Promise<RunTrace[]> {
    const rows = selectAll<StoreRow>(this.#db, "SELECT * FROM run_traces WHERE run_id = ? AND checkpoint_id = ? ORDER BY seq ASC, id ASC", [runId, checkpointId]);
    return rows.map((r) => rowToTrace(r));
  }

  async update(id: string, patch: PatchTrace): Promise<RunTrace | null> {
    return this.#writes.enqueue(async (): Promise<RunTrace | null> => {
      return transactional(this.#db, (): RunTrace | null => {
        const cur = selectOne<StoreRow>(this.#db, "SELECT * FROM run_traces WHERE id = ?", [id]);
        if (!cur) return null;
        const status: string = patch.status ?? String(cur.status);
        const ended = patch.endedAt !== undefined ? patch.endedAt : (cur.ended_at != null ? Number(cur.ended_at) : null);
        const dur = patch.durationMs !== undefined ? patch.durationMs : (cur.duration_ms != null ? Number(cur.duration_ms) : null);
        const detail = patch.detail ?? (typeof cur.detail === "string" && cur.detail.length > 0 ? JSON.parse(cur.detail) : {});
        execute(this.#db, "UPDATE run_traces SET ended_at = ?, duration_ms = ?, status = ?, detail = ? WHERE id = ?", [ended, dur, status, JSON.stringify(detail), id]);
        const updated = selectOne<StoreRow>(this.#db, "SELECT * FROM run_traces WHERE id = ?", [id]);
        return updated ? rowToTrace(updated) : null;
      });
    });
  }

  async delete(id: string): Promise<boolean> {
    return this.#writes.enqueue(async (): Promise<boolean> => {
      const res = execute(this.#db, "DELETE FROM run_traces WHERE id = ?", [id]);
      return (res.changes ?? 0) > 0;
    });
  }
}
