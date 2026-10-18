// Schedules repository (Todo 19). Typed CRUD over the `schedules` table. Cron-driven
// automation definitions; `enabled` is stored as INTEGER 0/1 and toggled via setEnabled.
//
// Statements are plain parameterized SQL executed over the runtime-selected PAL
// SqliteDb (bun:sqlite / node:sqlite): every value is bound positionally, so no user
// input is ever string-concatenated into SQL. Read-modify-write updates run inside a
// BEGIN IMMEDIATE span so two connections on one file cannot lose a write.

import { randomUUID } from "node:crypto";
import type { SqliteDb, SqliteRow } from "../pal";
import type { WriteQueue } from "./write-chain";
import { execute, selectAll, selectOne, transactional, type StoreRow } from "./sql";
import type { CreateScheduleInput, PatchSchedule, Schedule, SchedulesRepo } from "./types";

function rowToSchedule(row: SqliteRow): Schedule {
  return {
    id: String(row.id),
    name: String(row.name),
    cronSpec: String(row.cronSpec),
    actionType: String(row.actionType),
    params: typeof row.params === "string" && row.params.length > 0 ? JSON.parse(row.params) : {},
    enabled: !!row.enabled,
    nextRunAt: row.nextRunAt != null ? Number(row.nextRunAt) : undefined,
    lastRunAt: row.lastRunAt != null ? Number(row.lastRunAt) : undefined,
  };
}

export class SchedulesRepository implements SchedulesRepo {
  readonly #db: SqliteDb;
  readonly #writes: WriteQueue;

  /** @param db Runtime-selected synchronous sqlite connection shared with every repository. @param writes Shared single-writer serialization queue owned by StoreImpl. */
  constructor(db: SqliteDb, writes: WriteQueue) {
    this.#db = db;
    this.#writes = writes;
  }

  async create(input: CreateScheduleInput): Promise<Schedule> {
    const rec = {
      id: randomUUID(),
      name: input.name,
      cronSpec: input.cronSpec,
      actionType: input.actionType,
      params: input.params ?? {},
      enabled: input.enabled !== false ? 1 : 0,
      nextRunAt: input.nextRunAt ?? null,
      lastRunAt: input.lastRunAt ?? null,
    };
    return this.#writes.enqueue(async (): Promise<Schedule> => {
      execute(
        this.#db,
        "INSERT INTO schedules (id, name, cronSpec, actionType, params, enabled, nextRunAt, lastRunAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [rec.id, rec.name, rec.cronSpec, rec.actionType, JSON.stringify(rec.params), rec.enabled, rec.nextRunAt, rec.lastRunAt],
      );
      const row = selectOne<StoreRow>(this.#db, "SELECT * FROM schedules WHERE id = ?", [rec.id]);
      return row ? rowToSchedule(row) : ({ ...rec, enabled: rec.enabled === 1, params: rec.params } as Schedule);
    });
  }

  async get(id: string): Promise<Schedule | null> {
    const row = selectOne<StoreRow>(this.#db, "SELECT * FROM schedules WHERE id = ?", [id]);
    return row ? rowToSchedule(row) : null;
  }

  async list(): Promise<Schedule[]> {
    const rows = selectAll<StoreRow>(this.#db, "SELECT * FROM schedules ORDER BY name ASC, id ASC");
    return rows.map((r) => rowToSchedule(r));
  }

  async update(id: string, patch: PatchSchedule): Promise<Schedule | null> {
    return this.#writes.enqueue(async (): Promise<Schedule | null> => {
      return transactional(this.#db, (): Schedule | null => {
        const cur = selectOne<StoreRow>(this.#db, "SELECT * FROM schedules WHERE id = ?", [id]);
        if (!cur) return null;
        const base = rowToSchedule(cur);
        const merged = {
          name: patch.name !== undefined ? patch.name : base.name,
          cronSpec: patch.cronSpec !== undefined ? patch.cronSpec : base.cronSpec,
          actionType: patch.actionType !== undefined ? patch.actionType : base.actionType,
          params: patch.params !== undefined ? patch.params : base.params,
          enabled: patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : base.enabled ? 1 : 0,
          nextRunAt: patch.nextRunAt !== undefined ? patch.nextRunAt : base.nextRunAt ?? null,
          lastRunAt: patch.lastRunAt !== undefined ? patch.lastRunAt : base.lastRunAt ?? null,
        };
        execute(
          this.#db,
          "UPDATE schedules SET name = ?, cronSpec = ?, actionType = ?, params = ?, enabled = ?, nextRunAt = ?, lastRunAt = ? WHERE id = ?",
          [merged.name, merged.cronSpec, merged.actionType, JSON.stringify(merged.params), merged.enabled, merged.nextRunAt, merged.lastRunAt, id],
        );
        const updated = selectOne<StoreRow>(this.#db, "SELECT * FROM schedules WHERE id = ?", [id]);
        return updated ? rowToSchedule(updated) : null;
      });
    });
  }

  async setEnabled(id: string, enabled: boolean): Promise<Schedule | null> {
    return this.update(id, { enabled });
  }

  async delete(id: string): Promise<boolean> {
    return this.#writes.enqueue(async (): Promise<boolean> => {
      const res = execute(this.#db, "DELETE FROM schedules WHERE id = ?", [id]);
      return (res.changes ?? 0) > 0;
    });
  }
}
