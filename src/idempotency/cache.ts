// SQLite-backed idempotency cache (Todo 13).
//
// dbt #14550 lesson: never check-then-set on shared in-memory maps. SQLite
// already provides atomic transactions, so we use WAL + busy_timeout and route
// ALL writes through a single serialized queue (no concurrent writers, no
// read-modify-write races on an in-memory structure).
//
// The SQLite handle is runtime-selected via the PAL: bun:sqlite under Bun,
// node:sqlite under Node. No bun: value import is resolved at module load.

import { getPAL, type SqliteDb } from "../pal";
import type { CacheEntry, IdempotencyCache } from "./types";

/** @summary SQLite-backed idempotency cache that serializes every write through one promise chain and routes storage through the runtime-selected SQLite PAL. */
export class SqliteIdempotencyCache implements IdempotencyCache {
  private db: SqliteDb;
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(path: string = ":memory:") {
    this.db = getPAL().sqlite.open(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS idempotency_cache (" +
        "key TEXT PRIMARY KEY, observed TEXT NOT NULL, applied_at INTEGER NOT NULL)",
    );
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    const row = this.db
      .query("SELECT observed, applied_at FROM idempotency_cache WHERE key = ?")
      .get(key) as { observed: string; applied_at: number } | null | undefined;
    if (!row) return undefined;
    return { observed: JSON.parse(row.observed), appliedAt: row.applied_at };
  }

  async has(key: string): Promise<boolean> {
    const row = this.db
      .query("SELECT 1 FROM idempotency_cache WHERE key = ?")
      .get(key);
    return row !== null && row !== undefined;
  }

  set(key: string, entry: CacheEntry): Promise<void> {
    // Serialize every write through a single promise chain (single writer).
    const next = this.writeChain.then(() => {
      this.db
        .query(
          "INSERT INTO idempotency_cache (key, observed, applied_at) VALUES (?, ?, ?) " +
            "ON CONFLICT(key) DO UPDATE SET observed = excluded.observed, applied_at = excluded.applied_at",
        )
        .run(key, JSON.stringify(entry.observed ?? null), entry.appliedAt);
    });
    // Keep the chain alive even if a write rejects.
    this.writeChain = next.catch(() => undefined);
    return next.then(() => undefined);
  }

  close(): void {
    this.db.close();
  }
}
