// Bun-native SQLite PAL — wraps bun:sqlite (pure native, no addon).
//
// The bun:sqlite value import is obtained lazily inside open() via createRequire:
// a top-level (or dynamically hoisted) import of bun:sqlite leaks into the Node
// bundle and crashes Node at load. createRequire is only evaluated when a DB is
// actually opened, so the module stays import-safe under both runtimes. The
// type-only import below is erased at build time.
import { createRequire } from "node:module";
import type { Database } from "bun:sqlite";
import type { SqliteDb, SqlitePAL, SqliteStatement, SqlBinding, SqliteRow } from "./types";

class BunSqliteDb implements SqliteDb {
  #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  exec(sql: string): void {
    this.#db.run(sql);
  }

  run(sql: string, params?: SqlBinding) {
    return this.#db.run(sql, params as never);
  }

  query<T = SqliteRow>(sql: string): SqliteStatement<T> {
    const stmt = this.#db.query<T, SqlBinding>(sql);
    // bun:sqlite types Statement methods as single-binding tuples; cast at the FFI seam.
    // Statement methods bind params as SPREAD args at the native FFI seam (matches
    // the SqliteStatement interface's ...params contract). A single param slot here
    // silently drops extra arguments, so multi-column inserts fail with
    // "expected N values, received 1" — a bug fixed for Todo 19.
    return {
      all: (...params: SqlBinding[]) => stmt.all(...(params as never)) as T[],
      get: (...params: SqlBinding[]) => stmt.get(...(params as never)) as T | null,
      run: (...params: SqlBinding[]) => stmt.run(...(params as never)),
    };
  }

  close(): void {
    this.#db.close();
  }
}

/** @summary Bun-runtime SQLite PAL that lazily loads bun:sqlite's Database constructor and wraps it in the shared SqliteDb adapter. @param path Database file path (or ":memory:"). @returns A synchronous SqliteDb wrapper over a bun:sqlite Database. */
export class BunSqlitePAL implements SqlitePAL {
  open(path: string): SqliteDb {
    const bunSqlite = createRequire(import.meta.url)("bun:sqlite") as typeof import("bun:sqlite");
    const db = new bunSqlite.Database(path, { create: true });
    return new BunSqliteDb(db);
  }
}
