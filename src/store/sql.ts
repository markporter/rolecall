// Internal SQL helpers shared by the store repositories (Todo 19).
//
// The repositories run against the project's PAL SqliteDb seam, which is a real,
// SYNCHRONOUS sqlite handle on both runtimes (bun:sqlite under Bun, node:sqlite
// under Node). Because the handle is synchronous, a transaction body containing no
// `await` is atomic on its connection — so read-modify-write sequences are wrapped in
// `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` to keep two connections sharing one file
// from interleaving a check-then-set and losing a write (dbt #14550 lesson). Values are
// always bound positionally (spread params) through the PAL — never string-concatenated.

import type { SqliteDb, SqliteRow, SqlBinding } from "../pal";

/** A single persisted row: column-name keyed with native JS values. */
export type StoreRow = SqliteRow;

/** Outcome of a state-changing statement. `lastInsertRowid` may be bigint on node:sqlite. */
export interface StoreRunResult {
  lastInsertRowid: number | bigint;
  changes: number;
}

/** Execute a parameterized SELECT and return every row. */
export function selectAll<T = StoreRow>(db: SqliteDb, sql: string, params: readonly SqlBinding[] = []): T[] {
  return db.query<T>(sql).all(...params);
}

/** Execute a parameterized SELECT and return its first row, or null when there is none. */
export function selectOne<T = StoreRow>(db: SqliteDb, sql: string, params: readonly SqlBinding[] = []): T | null {
  return db.query<T>(sql).get(...params);
}

/** Execute one parameterized write statement (INSERT / UPDATE / DELETE) synchronously. */
export function execute(db: SqliteDb, sql: string, params: readonly SqlBinding[] = []): StoreRunResult {
  return db.query(sql).run(...params);
}

/**
 * Run `body` inside a BEGIN IMMEDIATE ... COMMIT span, rolling back and rethrowing on
 * failure. `body` MUST be synchronous — an `await` inside would let unrelated work run
 * between statements and defeat the atomicity the span is meant to provide.
 * @param db The synchronous sqlite connection to fence the statements on.
 * @param body Synchronous unit of work; its return value is passed through.
 * @returns Whatever `body` returned, after a successful COMMIT.
 */
export function transactional<T>(db: SqliteDb, body: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = body();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // A failed COMMIT may have already ended the transaction; surface the original error.
    }
    throw err;
  }
}
