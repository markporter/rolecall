// Node-runtime SQLite PAL — prefers node:sqlite's DatabaseSync, falling back to
// bun:sqlite's Database when node:sqlite is unavailable (forced-node tests still
// run ON Bun, which ships no node:sqlite). Both handles share the same sync FFI.
import { createRequire } from "node:module";
import type { SqliteDb, SqlitePAL, SqliteStatement, SqlBinding, SqliteRow } from "./types";

// Minimal structural view of the synchronous sqlite handle shared by
// node:sqlite's DatabaseSync and bun:sqlite's Database at the FFI seam.
interface SqlitePrepared {
  all(...params: SqlBinding[]): SqliteRow[];
  get(...params: SqlBinding[]): SqliteRow | undefined;
  run(...params: SqlBinding[]): { lastInsertRowid: number | bigint; changes: number };
}

interface SqliteHandle {
  exec(sql: string): void;
  prepare(sql: string): SqlitePrepared;
  close(): void;
}

type OpenDatabase = (path: string) => SqliteHandle;

function loadOpenDatabase(): OpenDatabase {
  const req = createRequire(import.meta.url);

  let nodeError: unknown;
  try {
    const mod = req("node:sqlite") as { DatabaseSync?: new (path: string) => SqliteHandle };
    if (typeof mod.DatabaseSync === "function") {
      const DatabaseSync = mod.DatabaseSync;
      return (path) => new DatabaseSync(path);
    }
    nodeError = new Error("node:sqlite did not expose DatabaseSync");
  } catch (err) {
    nodeError = err;
  }

  let bunError: unknown;
  try {
    const mod = req("bun:sqlite") as {
      Database?: new (path: string, options: { create: boolean }) => SqliteHandle;
    };
    if (typeof mod.Database === "function") {
      const Database = mod.Database;
      return (path) => new Database(path, { create: true });
    }
    bunError = new Error("bun:sqlite did not expose Database");
  } catch (err) {
    bunError = err;
  }

  const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));
  throw new Error(
    `PAL sqlite unavailable: node:sqlite failed (${message(nodeError)}) and bun:sqlite fallback failed (${message(bunError)})`,
  );
}

class NodeSqliteDb implements SqliteDb {
  #db: SqliteHandle;

  constructor(db: SqliteHandle) {
    this.#db = db;
  }

  exec(sql: string): void {
    this.#db.exec(sql);
  }

  run(sql: string, params?: SqlBinding) {
    const stmt = this.#db.prepare(sql);
    return params === undefined ? stmt.run() : stmt.run(params);
  }

  query<T = SqliteRow>(sql: string): SqliteStatement<T> {
    const stmt = this.#db.prepare(sql);
    // Statement methods bind params as SPREAD args (matches the SqliteStatement
    // interface's ...params contract). node:sqlite's get() returns undefined for
    // no row — normalize to null to match bun:sqlite and the interface.
    return {
      all: (...params: SqlBinding[]) => stmt.all(...params) as unknown as T[],
      get: (...params: SqlBinding[]) => (stmt.get(...params) ?? null) as unknown as T | null,
      run: (...params: SqlBinding[]) => stmt.run(...params),
    };
  }

  close(): void {
    this.#db.close();
  }
}

/** @summary Node-runtime SQLite PAL that opens a synchronous database via node:sqlite's DatabaseSync, falling back to bun:sqlite when node:sqlite is absent. @param path Database file path (or ":memory:"). @returns A synchronous SqliteDb wrapper over the resolved sqlite handle. */
export class NodeSqlitePAL implements SqlitePAL {
  open(path: string): SqliteDb {
    return new NodeSqliteDb(loadOpenDatabase()(path));
  }
}
