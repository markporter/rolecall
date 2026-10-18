// Public API shapes for the durable project/run/schedule registry (Todo 19).
//
// Three entities are persisted as rows in a single sqlite database opened through the
// runtime-selected PAL SqliteDb (bun:sqlite under Bun, node:sqlite under Node).
// JSON columns (vars/history/payload/params
// and targetIds arrays) are stored as TEXT via JSON.stringify on write and
// parsed back on read so callers always see native JS values. Timestamps are
// integer epoch-millisecond counters. `enabled` is stored as INTEGER 0/1. Backend
// selection lives in openStore() behind ROLECALL_DB_BACKEND (default sqlite); postgres is
// deferred.

import type { DbBackend } from "../config/env";

/** A persisted Project row. */
export interface Project {
  id: string;
  /** Absolute filesystem path this project governs. */
  path: string;
  inventoryRef?: string;
  playbookRef?: string;
  vars: Record<string, unknown>;
  history: unknown[];
  createdAt: number;
  updatedAt: number;
}

/** Input for creating a project; only `path` is required. */
export interface CreateProjectInput {
  path: string;
  inventoryRef?: string;
  playbookRef?: string;
  vars?: Record<string, unknown>;
  history?: unknown[];
}

/** Patch applied to an existing project; provided fields replace/merge. */
export interface UpdateProjectPatch {
  path?: string;
  inventoryRef?: string;
  playbookRef?: string;
  vars?: Record<string, unknown>;
  /** Appended to the existing history array rather than replacing it. */
  history?: unknown[];
}

/** A persisted Run record — one orchestrator/scheduler/webhook invocation. */
export interface Run {
  id: string;
  projectId?: string;
  actionType: string;
  targetIds: string[];
  status: string;
  resultSummary?: string;
  startedAt: number;
  finishedAt?: number;
  payload: Record<string, unknown>;
}

/**
 * A single execution-trace ledger row (Todo 25). Records one task/iteration
 * event for a run with timing + outcome, enabling replay, failure-locality, and
 * per-task/per-host performance profiling. `detail` is a flexible JSON column so
 * later todos (26: tx_id / checkpoint) can extend the ledger without a migration.
 * Todo 26 additionally carries `txId` + `checkpointId` as first-class columns so a
 * run's applied deltas can be grouped into dependent transactions / checkpoints for
 * rollback + resume (see src/executor/tx.ts).
 */
export interface RunTrace {
  /** Surrogate primary key. */
  id: string;
  /** Run this event belongs to (foreign key to runs.id, logical only). */
  runId: string;
  /** Host/target the event occurred on (empty string for host-agnostic phases). */
  host: string;
  /** Task name the event is scoped to. */
  taskName: string;
  /** Loop iteration index (-1 for whole-task events with no single iteration). */
  iteration: number;
  /** Lifecycle phase: start | end | when-eval | render | idempotency | module-run | register | notify. */
  phase: string;
  /** Outcome status: running | ok | failed | skipped. */
  status: string;
  /** Epoch-ms when the phase began. */
  startedAt: number;
  /** Epoch-ms when the phase ended (null while running / for start rows). */
  endedAt: number | null;
  /** Wall-clock duration in ms (null for start rows / still running). */
  durationMs: number | null;
  /**
   * Transaction id (Todo 26). Plays/tasks sharing a `txId` are *dependent*: on a
   * member failure the tx's applied ledger rows are reverse-walked and undone.
   * Absent => the event belongs to no transaction (resumable in isolation).
   */
  txId?: string;
  /**
   * Checkpoint id (Todo 26). Marks the savepoint this delta was applied under.
   * On partial rollback only deltas applied *after* the last reached checkpoint
   * are undone; deltas at/before it are preserved. Absent => base checkpoint.
   */
  checkpointId?: string;
  /** Auxiliary structured data (error message, summary, …). */
  detail: Record<string, unknown>;
  /** Monotonic within-run ordering (assigned on write). */
  seq: number;
}

/**
 * A single reversible delta recorded in the run-trace ledger (Todo 26). Derived
 * from a {@link RunTrace} "end" row; carries just the fields the tx engine needs to
 * reverse-walk and undo an applied change. `module` is recovered from the trace's
 * `detail.module` (recorded by the executor) or the task's module at emit time.
 */
export interface TxLedgerRow {
  /** Run this delta belongs to. */
  runId: string;
  /** Host the delta was applied on. */
  host: string;
  /** Task name the delta is scoped to. */
  taskName: string;
  /** Module that produced the delta (from `detail.module`). */
  module: string;
  /** Transaction id grouping dependent deltas. */
  txId: string;
  /** Checkpoint this delta was applied under (undefined => base). */
  checkpointId?: string;
  /** Within-run ordering; reverse-walk undoes in descending seq. */
  seq: number;
  /** True when the module reported a real change (vs a no-op apply). */
  changed: boolean;
}

/** Input for creating a trace row. `id`/`seq` are assigned when omitted. */
export interface CreateTraceInput {
  id?: string;
  runId: string;
  host?: string;
  taskName: string;
  iteration?: number;
  phase: string;
  status: string;
  startedAt?: number;
  endedAt?: number | null;
  durationMs?: number | null;
  /** Transaction id (Todo 26); groups dependent applied deltas for rollback. */
  txId?: string;
  /** Checkpoint id (Todo 26); marks the savepoint this delta was applied under. */
  checkpointId?: string;
  detail?: Record<string, unknown>;
  seq?: number;
}

/** Partial mutation of a trace (e.g. mark a start row ended). */
export interface PatchTrace {
  endedAt?: number | null;
  durationMs?: number | null;
  status?: string;
  detail?: Record<string, unknown>;
}

/** Input for creating a run. When `id` is omitted the repository assigns one. */
export interface CreateRunInput {
  id?: string;
  projectId?: string;
  actionType: string;
  targetIds?: string[];
  status?: string;
  resultSummary?: string;
  startedAt?: number;
  finishedAt?: number;
  payload?: Record<string, unknown>;
}

/** Partial mutation of a run (e.g. mark finished / set summary). */
export interface PatchRun {
  status?: string;
  resultSummary?: string;
  finishedAt?: number;
}

/** A persisted Schedule definition (cron-driven automation). */
export interface Schedule {
  id: string;
  name: string;
  cronSpec: string;
  actionType: string;
  params: Record<string, unknown>;
  enabled: boolean;
  nextRunAt?: number;
  lastRunAt?: number;
}

/** Input for creating a schedule. */
export interface CreateScheduleInput {
  name: string;
  cronSpec: string;
  actionType: string;
  params?: Record<string, unknown>;
  enabled?: boolean;
  nextRunAt?: number;
  lastRunAt?: number;
}

/** Partial mutation of a schedule. */
export interface PatchSchedule {
  name?: string;
  cronSpec?: string;
  actionType?: string;
  params?: Record<string, unknown>;
  enabled?: boolean;
  nextRunAt?: number;
  lastRunAt?: number;
}

/** Typed CRUD over the projects table. */
export interface ProjectsRepo {
  create(input: CreateProjectInput): Promise<Project>;
  get(id: string): Promise<Project | null>;
  list(): Promise<Project[]>;
  update(id: string, patch: UpdateProjectPatch): Promise<Project | null>;
  delete(id: string): Promise<boolean>;
}

/** Typed CRUD over the runs table. */
export interface RunsRepo {
  create(input: CreateRunInput): Promise<Run>;
  get(id: string): Promise<Run | null>;
  list(projectId?: string): Promise<Run[]>;
  update(id: string, patch: PatchRun): Promise<Run | null>;
  delete(id: string): Promise<boolean>;
}

/** Typed CRUD over the run_traces ledger (Todo 25). */
export interface TracesRepo {
  create(input: CreateTraceInput): Promise<RunTrace>;
  get(id: string): Promise<RunTrace | null>;
  /** All traces for a run, ordered by ascending seq (replay order). */
  listByRun(runId: string): Promise<RunTrace[]>;
  /** All traces for a transaction (Todo 26), ordered by descending seq (undo-walk order). */
  listByTx(txId: string): Promise<RunTrace[]>;
  /** All traces for a run under a specific checkpoint (Todo 26), ordered by ascending seq. */
  listByRunCheckpoint(runId: string, checkpointId: string): Promise<RunTrace[]>;
  update(id: string, patch: PatchTrace): Promise<RunTrace | null>;
  delete(id: string): Promise<boolean>;
}

/** Typed CRUD over the schedules table. */
export interface SchedulesRepo {
  create(input: CreateScheduleInput): Promise<Schedule>;
  get(id: string): Promise<Schedule | null>;
  list(): Promise<Schedule[]>;
  update(id: string, patch: PatchSchedule): Promise<Schedule | null>;
  setEnabled(id: string, enabled: boolean): Promise<Schedule | null>;
  delete(id: string): Promise<boolean>;
}

/** Handle returned by openStore(); owns the DB connection + write serializer, exposing entity CRUD as typed sub-collections (projects/runs/schedules). */
export interface Store {
  /**
   * Absolute path of the backing sqlite file this store resolves to.
   * Always defined for the default SQLite backend; undefined for later non-file backends.
   */
  readonly dbPath?: string;
  readonly projects: ProjectsRepo;
  readonly runs: RunsRepo;
  readonly schedules: SchedulesRepo;
  /** Execution-trace ledger (Todo 25): per-task/per-iteration timing + outcome. */
  readonly traces: TracesRepo;
  close(): void;
}

/**
 * Options accepted by openStore(). Resolution precedence: an explicit `dbBackend`,
 * then ROLECALL_DB_BACKEND via loadConfig(), defaults to sqlite — a postgres value throws
 * (deferred). Then dbPath > <projectDir>/.rolecall > global ~/.rolecall (ROLECALL_HOME/ROLECALL_PROJECT_STATE).
 */
export interface OpenStoreOptions {
  /** Override the database backend ("sqlite" | "postgres"). Defaults to ROLECALL_DB_BACKEND / sqlite. Postgres is deferred. */
  dbBackend?: DbBackend;
  /** Explicit absolute path to the sqlite file. Highest precedence. */
  dbPath?: string;
  /** When set, state resolves under `<projectDir>/.rolecall/` (wins over global). */
  projectDir?: string;
}
