// Runs repository (Todo 19). Typed CRUD over the `runs` table. A run records one
// orchestrator / scheduler / webhook invocation and its outcome.
//
// Statements are plain parameterized SQL executed over the runtime-selected PAL
// SqliteDb (bun:sqlite / node:sqlite): every value is bound positionally, so no user
// input is ever string-concatenated into SQL. Read-modify-write updates run inside a
// BEGIN IMMEDIATE span so two connections on one file cannot lose a write.

import { randomUUID } from "node:crypto";
import type { SqliteDb, SqliteRow } from "../pal";
import type { WriteQueue } from "./write-chain";
import { execute, selectAll, selectOne, transactional, type StoreRow } from "./sql";
import type { CreateRunInput, PatchRun, Run, RunsRepo } from "./types";

function rowToRun(row: SqliteRow): Run {
  return {
    id: String(row.id),
    projectId: row.projectId != null ? String(row.projectId) : undefined,
    actionType: String(row.actionType),
    targetIds: typeof row.targetIds === "string" && row.targetIds.length > 0 ? JSON.parse(row.targetIds) : [],
    status: String(row.status),
    resultSummary: row.resultSummary != null ? String(row.resultSummary) : undefined,
    startedAt: Number(row.startedAt),
    finishedAt: row.finishedAt != null ? Number(row.finishedAt) : undefined,
    payload: typeof row.payload === "string" && row.payload.length > 0 ? JSON.parse(row.payload) : {},
  };
}

export class RunsRepository implements RunsRepo {
  readonly #db: SqliteDb;
  readonly #writes: WriteQueue;

  /** @param db Runtime-selected synchronous sqlite connection shared with every repository. @param writes Shared single-writer serialization queue owned by StoreImpl. */
  constructor(db: SqliteDb, writes: WriteQueue) {
    this.#db = db;
    this.#writes = writes;
  }

  async create(input: CreateRunInput): Promise<Run> {
    const now = Date.now();
    const rec = {
      id: input.id ?? randomUUID(),
      projectId: input.projectId ?? null,
      actionType: input.actionType,
      targetIds: input.targetIds ?? [],
      status: input.status ?? "started",
      resultSummary: input.resultSummary ?? null,
      startedAt: input.startedAt ?? now,
      finishedAt: input.finishedAt ?? null,
      payload: input.payload ?? {},
    };
    return this.#writes.enqueue(async (): Promise<Run> => {
      execute(
        this.#db,
        "INSERT INTO runs (id, projectId, actionType, targetIds, status, resultSummary, startedAt, finishedAt, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [rec.id, rec.projectId, rec.actionType, JSON.stringify(rec.targetIds), rec.status, rec.resultSummary, rec.startedAt, rec.finishedAt, JSON.stringify(rec.payload)],
      );
      const row = selectOne<StoreRow>(this.#db, "SELECT * FROM runs WHERE id = ?", [rec.id]);
      return row ? rowToRun(row) : ({ id: rec.id, actionType: rec.actionType, targetIds: rec.targetIds, status: rec.status, startedAt: rec.startedAt, payload: rec.payload } as Run);
    });
  }

  async get(id: string): Promise<Run | null> {
    const row = selectOne<StoreRow>(this.#db, "SELECT * FROM runs WHERE id = ?", [id]);
    return row ? rowToRun(row) : null;
  }

  async list(projectId?: string): Promise<Run[]> {
    if (projectId === undefined) {
      const rows = selectAll<StoreRow>(this.#db, "SELECT * FROM runs ORDER BY startedAt ASC, id ASC");
      return rows.map((r) => rowToRun(r));
    }
    const rows = selectAll<StoreRow>(this.#db, "SELECT * FROM runs WHERE projectId = ? ORDER BY startedAt ASC, id ASC", [projectId]);
    return rows.map((r) => rowToRun(r));
  }

  async update(id: string, patch: PatchRun): Promise<Run | null> {
    return this.#writes.enqueue(async (): Promise<Run | null> => {
      return transactional(this.#db, (): Run | null => {
        const cur = selectOne<StoreRow>(this.#db, "SELECT * FROM runs WHERE id = ?", [id]);
        if (!cur) return null;
        // Preserve prior values for columns the patch does not touch.
        const status: string = patch.status ?? String(cur.status);
        const summary: string | null = patch.resultSummary ?? (cur.resultSummary != null ? String(cur.resultSummary) : null);
        const finished: number | null = patch.finishedAt ?? (cur.finishedAt != null ? Number(cur.finishedAt) : null);
        if (patch.status !== undefined || patch.resultSummary !== undefined || patch.finishedAt !== undefined) {
          execute(this.#db, "UPDATE runs SET status = ?, resultSummary = ?, finishedAt = ? WHERE id = ?", [status, summary, finished, id]);
        }
        const updated = selectOne<StoreRow>(this.#db, "SELECT * FROM runs WHERE id = ?", [id]);
        return updated ? rowToRun(updated) : null;
      });
    });
  }

  async delete(id: string): Promise<boolean> {
    return this.#writes.enqueue(async (): Promise<boolean> => {
      const res = execute(this.#db, "DELETE FROM runs WHERE id = ?", [id]);
      return (res.changes ?? 0) > 0;
    });
  }
}
