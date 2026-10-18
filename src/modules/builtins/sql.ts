// Batteries-included idempotent `sql` module (Todo 27).
//
// Runs an idempotent SQL statement against a SQLite database opened directly from
// the RoleCall process via the runtime-selected SQLite PAL (`bun:sqlite` under Bun,
// `node:sqlite` under Node). Idempotency is intrinsic: `describe`
// runs an optional `check_query` and reports `inDesired` when the desired state is
// already present (e.g. the table/row already exists); `converge` only runs the
// mutating `query` when `describe` reported not-in-desired, so re-applying an
// already-applied migration is a skipped no-op. Pair with `check_query` such as
// `SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'`.

import { getPAL, type SqliteDb } from "../../pal";
import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { CheckableModule } from "../../idempotency/types";
import { resource } from "../resource";
import type { ModuleSummary } from "../search";

/** Search metadata for the `sql` module (auto-collected by builtins/index.ts). */
export const meta: ModuleSummary = {
  name: "sql",
  description:
    "Idempotent SQL module: runs the mutating query only when check_query shows the desired state is not yet present.",
  idempotent: true,
  source: "builtin",
  args: {
    db: {
      type: "string",
      required: true,
      description: "Path to the SQLite database file (created if missing).",
    },
    query: {
      type: "string",
      required: true,
      description: "Mutating SQL statement to run on converge (idempotent via check_query).",
    },
    check_query: {
      type: "string",
      required: false,
      description: "Probe: when it returns >= expected_rows rows, state is in-desired.",
    },
    params: { type: "unknown[]", required: false, description: "Bound parameters for query." },
    check_params: {
      type: "unknown[]",
      required: false,
      description: "Bound parameters for check_query.",
    },
    expected_rows: {
      type: "number",
      required: false,
      description: "Rows check_query must return to be considered applied (default 1).",
    },
  },
  examples: [
    `- sql:
    db: app.db
    query: 'CREATE TABLE IF NOT EXISTS users(id INTEGER)'
    check_query: "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='users'"
    expected_rows: 1`,
    `- sql:
    db:
      $var: vars.db_path
    query:
      $call: migrate_users
    check_query: "SELECT max(version) FROM schema_migrations"
    params:
      - $var: vars.target_version`,
  ],
};

interface SqlArgs {
  /** Path to the SQLite database file (created if missing). Required. */
  db: string;
  /** Mutating SQL statement to run on converge (idempotent via check_query). */
  query: string;
  /** Optional probe: when it returns >= `expected_rows` rows, state is in-desired. */
  check_query?: string;
  /** Bound parameters for `query`. */
  params?: unknown[];
  /** Bound parameters for `check_query`. */
  check_params?: unknown[];
  /** Rows `check_query` must return to be considered applied (default 1). */
  expected_rows?: number;
}

function open(db: string): SqliteDb {
  return getPAL().sqlite.open(db);
}

/** @summary Idempotent SQL module: runs `query` only when `check_query` shows the desired state is not yet present. @param args SqlArgs (db, query, check_query, params, check_params, expected_rows). @returns Module & CheckableModule. */
export const sqlModule: Module & CheckableModule = resource({
  name: "sql",
  async describe(args) {
    const a = args as unknown as SqlArgs;
    const db = String(a.db ?? "");
    if (!db || !a.query) return { current: null, inDesired: false };
    if (!a.check_query) return { current: null, inDesired: false };
    let conn: SqliteDb | undefined;
    try {
      conn = open(db);
      const rows = conn
        .query(a.check_query)
        .all(...((a.check_params ?? []) as never[])) as unknown[];
      const applied = rows.length >= (a.expected_rows ?? 1);
      return { current: { rows: rows.length }, inDesired: applied };
    } finally {
      conn?.close();
    }
  },
  async converge(args) {
    const a = args as unknown as SqlArgs;
    const db = String(a.db ?? "");
    if (!db || !a.query) {
      return { changed: false, failed: true, msg: "sql: 'db' and 'query' are required" };
    }
    let conn: SqliteDb | undefined;
    try {
      conn = open(db);
      conn.query(a.query).run(...((a.params ?? []) as never[]));
      return {
        changed: true,
        msg: `sql applied on ${db}`,
        data: { db, query: a.query },
      };
    } catch (err) {
      return {
        changed: false,
        failed: true,
        msg: `sql failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    } finally {
      conn?.close();
    }
  },
});

(sqlModule as Module & CheckableModule & { meta: ModuleSummary }).meta = meta;
