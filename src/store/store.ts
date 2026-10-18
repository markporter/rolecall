// Registry factory + durable Store (Todo 19).
//
// Path precedence (first match wins):
//   1. opts.dbPath                 -> absolute path given explicitly
//   2. <projectDir>/.rolecall/state.db  -> per-project state overrides the global one
//   3. $ROLECALL_PROJECT_STATE          -> env override of the project-state root
//   4. $ROLECALL_HOME (default ~/.rolecall)  -> global home registry
//
// The backend is selected by ROLECALL_DB_BACKEND (via loadConfig(), default sqlite). The
// SQLite backend opens a runtime-selected synchronous handle through the PAL
// (bun:sqlite under Bun, node:sqlite under Node), applies WAL + synchronous=NORMAL +
// busy_timeout pragmas and idempotent table creation, then hands every repository the
// shared {@link SqliteDb}. All mutations serialize through ONE WriteQueue. Postgres is
// recorded-only and throws. Because the PAL SqliteDb is synchronous on BOTH runtimes,
// openStore() works under Node as well as Bun with no await.

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { getPAL } from "../pal";
import type { SqliteDb } from "../pal";
import { loadConfig } from "../config/env";
import { SchedulesRepository } from "./schedules";
import { ProjectsRepository } from "./projects";
import { RunsRepository } from "./runs";
import { TracesRepository } from "./traces";
import { WriteQueue } from "./write-chain";
import type { OpenStoreOptions, Project, Run, Schedule, Store } from "./types";

/** File name of the sqlite registry inside a `.rolecall` state directory. */
export const REGISTRY_DB_NAME = "state.db";

/** Journaling / locking pragmas applied once at open time. */
const SCHEMA_PRAGMAS = [
  "PRAGMA journal_mode=WAL;",
  "PRAGMA synchronous=NORMAL;",
  "PRAGMA busy_timeout=5000;",
].join("\n");

const PROJECTS_TABLE = `CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  inventoryRef TEXT,
  playbookRef TEXT,
  vars TEXT NOT NULL DEFAULT '{}',
  history TEXT NOT NULL DEFAULT '[]',
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
)`;

const RUNS_TABLE = `CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  projectId TEXT,
  actionType TEXT NOT NULL,
  targetIds TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  resultSummary TEXT,
  startedAt INTEGER NOT NULL,
  finishedAt INTEGER,
  payload TEXT NOT NULL DEFAULT '{}'
)`;

const SCHEDULES_TABLE = `CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cronSpec TEXT NOT NULL,
  actionType TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  nextRunAt INTEGER,
  lastRunAt INTEGER
)`;

const RUN_TRACES_TABLE = `CREATE TABLE IF NOT EXISTS run_traces (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  host TEXT NOT NULL DEFAULT '',
  task_name TEXT NOT NULL,
  iteration INTEGER NOT NULL DEFAULT -1,
  phase TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  duration_ms INTEGER,
  tx_id TEXT,
  checkpoint_id TEXT,
  detail TEXT NOT NULL DEFAULT '{}',
  seq INTEGER NOT NULL
)`;

/** Concatenated table DDL for every registry table. Applied idempotently on open. */
const SCHEMA_DDL = [PROJECTS_TABLE, RUNS_TABLE, SCHEDULES_TABLE, RUN_TRACES_TABLE].join(";\n");

/** Resolve the absolute sqlite path using the documented precedence order. */
export function resolveRegistryPath(opts?: OpenStoreOptions): string {
  if (opts?.dbPath !== undefined) return opts.dbPath;
  if (opts?.projectDir !== undefined) return join(opts.projectDir, ".rolecall", REGISTRY_DB_NAME);
  const projectStateRoot = process.env.ROLECALL_PROJECT_STATE ?? join(process.env.ROLECALL_HOME ?? homedir(), ".rolecall");
  return join(projectStateRoot, REGISTRY_DB_NAME);
}

class StoreImpl implements Store {
  readonly #conn: SqliteDb;
  readonly #writes = new WriteQueue();
  readonly projects: ProjectsRepository;
  readonly runs: RunsRepository;
  readonly schedules: SchedulesRepository;
  readonly traces: TracesRepository;

  /** @param dbPath Absolute path of the backing sqlite file (undefined for later non-file backends). @param conn Runtime-selected synchronous sqlite connection shared with every repository. */
  constructor(readonly dbPath: string | undefined, conn: SqliteDb) {
    this.#conn = conn;
    this.projects = new ProjectsRepository(conn, this.#writes);
    this.runs = new RunsRepository(conn, this.#writes);
    this.schedules = new SchedulesRepository(conn, this.#writes);
    this.traces = new TracesRepository(conn, this.#writes);
  }

  close(): void {
    // The PAL handle's close() is synchronous on both runtimes, so no await is needed.
    this.#conn.close();
  }
}

/**
 * Open (creating if needed) the durable registry and return its typed API.
 * Backend selection reads ROLECALL_DB_BACKEND through loadConfig() (default sqlite).
 * The sqlite handle is runtime-selected via the PAL (bun:sqlite on Bun, node:sqlite on
 * Node), so this works under both runtimes.
 * @param opts Optional resolution options; an explicit `dbBackend` overrides the env value.
 * @returns A live Store whose repositories are backed by the PAL SqliteDb over the chosen backend.
 * TODO(ROLECALL-PLACEHOLDER): Postgres deferred (no fallback)
 * @throws If `postgres` is requested (deferred, no fallback).
 */
export function openStore(opts?: OpenStoreOptions): Store {
  const cfg = loadConfig();
  const backend = opts?.dbBackend ?? cfg.dbBackend ?? "sqlite";
  if (backend === "postgres") {
    // TODO(ROLECALL-PLACEHOLDER): Postgres backend not implemented (deferred)
    throw new Error("ROLECALL_DB_BACKEND=postgres is not implemented (deferred)");
  }

  const dbPath = resolveRegistryPath(opts);
  // The native sqlite handles open the file but do NOT create parent directories.
  mkdirSync(dirname(dbPath), { recursive: true });
  const conn = getPAL().sqlite.open(dbPath);
  // Durability pragmas + idempotent table creation run on the native multi-statement
  // executor before any repository touches the connection.
  conn.exec(`${SCHEMA_PRAGMAS}\n${SCHEMA_DDL}`);
  return new StoreImpl(dbPath, conn);
}

export type { Project, Run, Schedule };
export type {
  CreateProjectInput,
  UpdateProjectPatch,
  CreateRunInput,
  PatchRun,
  CreateScheduleInput,
  PatchSchedule,
} from "./types";
