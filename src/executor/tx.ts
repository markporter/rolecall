// Transaction + checkpoint engine (Todo 26).
//
// HONESTY NOTE: RoleCall's executor (`playbook run`) is a planning scaffold and does NOT
// apply real remote state — see AGENTS.md. This module is the genuine, tested
// transaction/checkpoint *layer* that operates over the RunTrace ledger
// (Todo 25) plus a module `undo` contract. It reverse-walks applied deltas,
// invokes each reversible module's `undo`, and reports non-reversible ones instead
// of silently dropping them. It is a pure, importable module: no server, no real
// transport — the tests drive it directly with in-memory ledger + fake modules.

import type { Module, ModuleContext, UndoableModule } from "./module";
import { isUndoableModule } from "./module";
import type { RunTrace } from "../store/types";
import { resolveModule } from "../modules/resolver";

/** A module or undoable-module, or undefined when not registered. */
export type AnyModule = Module | UndoableModule | undefined;

/**
 * A single reversible delta derived from a run-trace "end" row. Carries just the
 * fields the engine needs to reverse-walk and undo an applied change.
 */
export interface AppliedDelta {
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

/** Outcome of invoking one module's `undo`. */
export interface UndoOutcome {
  runId: string;
  host: string;
  taskName: string;
  module: string;
  /** False when undo returned failed or threw. */
  ok: boolean;
  msg?: string;
  /** Populated only when undo threw (vs returned failed). */
  error?: string;
}

/** An applied delta that could NOT be auto-rolled-back (and why). */
export interface PendingRollbackEntry {
  module: string;
  host: string;
  /** Task name (the row's `taskName`). */
  task: string;
  reason: string;
}

/** Full result of a transaction rollback walk. */
export interface RollbackResult {
  txId: string;
  /** Undo invocations, in reverse (descending seq) order. */
  undone: UndoOutcome[];
  /** Operations excluded from auto-rollback (no `undo` on their module). */
  pending: PendingRollbackEntry[];
  /** Seq of the last preserved checkpoint boundary (-Infinity => full rollback). */
  boundarySeq: number;
}

/** Inputs to {@link rollbackTransaction}. */
export interface RollbackInput {
  /** Transaction to roll back (members share this id in the ledger). */
  txId: string;
  /** The run-trace ledger (one or more runs) to scan for applied members. */
  ledger: RunTrace[];
  /** Resolve a module by name; absent/non-undoable => reported as pending. When omitted, the FQCN-aware {@link resolveModule} is used. */
  getModule?: (name: string) => AnyModule;
  /** Build an undo context for a delta (host/connection/args/desired scope). */
  buildContext: (delta: AppliedDelta) => ModuleContext;
  /**
   * Optional: desired-state value passed to each `undo(ctx, desired)`. Recovers the
   * pre-change intent (from `ModuleResult.data` / task args at apply time).
   */
  desiredFor?: (delta: AppliedDelta) => unknown;
  /**
   * Optional explicit checkpoint to preserve. Only deltas applied *after* this
   * checkpoint are undone; everything at/before it is kept (partial rollback). When
   * omitted and the tx has checkpoints, the last reached checkpoint is used; with no
   * checkpoints at all, the entire transaction is rolled back.
   */
  stopBeforeCheckpoint?: string;
}

/**
 * Derive an {@link AppliedDelta} from a ledger row, or `null` when the row is not a
 * committed (tx-scoped, end-phase, ok/changed) member of a transaction.
 * @param t A run-trace row.
 * @returns The reversible delta, or `null` when the row carries no `txId`, is not a
 * terminal "end" row, or did not succeed.
 */
export function toAppliedDelta(t: RunTrace): AppliedDelta | null {
  if (t.txId === undefined) return null;
  if (t.phase !== "end") return null;
  if (t.status !== "ok" && t.status !== "changed") return null;
  const moduleName =
    typeof t.detail.module === "string" ? t.detail.module : t.taskName;
  return {
    runId: t.runId,
    host: t.host,
    taskName: t.taskName,
    module: moduleName,
    txId: t.txId,
    checkpointId: t.checkpointId,
    seq: t.seq,
    changed: t.status === "changed" || t.detail.changed === true,
  };
}

/**
 * Resolve the seq boundary of the checkpoint to preserve. Deltas with
 * `seq <= boundary` are kept; only deltas strictly after it are undone.
 * @param deltas Applied deltas, ascending seq.
 * @param explicit When set, the boundary is the max seq of that checkpoint (or
 *   -Infinity when the checkpoint is absent, i.e. undo everything).
 * @returns -Infinity for a full rollback, else the last reached checkpoint seq.
 */
function computeBoundarySeq(deltas: AppliedDelta[], explicit?: string): number {
  if (explicit !== undefined) {
    const matching = deltas.filter((d) => d.checkpointId === explicit);
    return matching.length > 0 ? Math.max(...matching.map((d) => d.seq)) : -Infinity;
  }
  const withCp = deltas.filter((d) => d.checkpointId !== undefined);
  if (withCp.length === 0) return -Infinity; // no checkpoints => full rollback
  return Math.max(...withCp.map((d) => d.seq)); // last reached checkpoint
}

/**
 * Roll back a failed transaction by reverse-walking its applied ledger rows and
 * invoking each reversible module's `undo`. Non-reversible rows (module exposes no
 * `undo`, or is unregistered) are EXCLUDED from auto-rollback and collected into
 * `pending`. Pure + async: takes the ledger as data, returns the outcome.
 * @param input See {@link RollbackInput}.
 * @returns The per-delta undo outcomes + the non-reversible pending report.
 */
export async function rollbackTransaction(
  input: RollbackInput,
): Promise<RollbackResult> {
  const { txId, ledger, getModule, buildContext } = input;

  // Mirror the executor's FQCN-aware resolver when no custom resolver is supplied
  // (the test seam). Falls back to the registry/builtin lookup via resolveModule.
  const resolveForTx = (n: string): AnyModule => {
    const r = resolveModule(n);
    return r.kind === "module" ? r.module : undefined;
  };

  const deltas = ledger
    .map(toAppliedDelta)
    .filter((d): d is AppliedDelta => d !== null && d.txId === txId)
    .sort((a, b) => a.seq - b.seq);

  const boundarySeq = computeBoundarySeq(deltas, input.stopBeforeCheckpoint);
  const undone: UndoOutcome[] = [];
  const pending: PendingRollbackEntry[] = [];

  // Reverse walk: newest applied delta first, so undo replays in LIFO order.
  for (let i = deltas.length - 1; i >= 0; i--) {
    const d = deltas[i]!;
    if (d.seq <= boundarySeq) continue; // preserved at/before the checkpoint
    const mod = (getModule ?? resolveForTx)(d.module);
    if (mod && isUndoableModule(mod)) {
      try {
        const desired = input.desiredFor ? input.desiredFor(d) : undefined;
        const res = await mod.undo(buildContext(d), desired);
        undone.push({
          runId: d.runId,
          host: d.host,
          taskName: d.taskName,
          module: d.module,
          ok: !res.failed,
          msg: res.msg,
        });
      } catch (e) {
        undone.push({
          runId: d.runId,
          host: d.host,
          taskName: d.taskName,
          module: d.module,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    } else {
      pending.push({
        module: d.module,
        host: d.host,
        task: d.taskName,
        reason: mod
          ? `module '${d.module}' exposes no undo (non-reversible)`
          : `module '${d.module}' not found`,
      });
    }
  }

  return { txId, undone, pending, boundarySeq };
}

/**
 * Compute the set of task names already applied at/after a resume checkpoint, so a
 * `--resume <run_id>:<checkpoint>` run can skip them and continue only the unapplied
 * remainder. Reads the ledger (end-phase ok/changed rows) for `runId`, finds the
 * checkpoint boundary, and collects every applied `taskName` with seq at/after it.
 * @param ledger The run-trace ledger.
 * @param runId Run to resume.
 * @param checkpoint Checkpoint id marking the safe point to resume from.
 * @returns Task names to SKIP (already applied at/after the checkpoint).
 */
export function computeResumeSkipSet(
  ledger: RunTrace[],
  runId: string,
  checkpoint: string,
): Set<string> {
  const applied = ledger
    .filter(
      (t) =>
        t.runId === runId &&
        t.phase === "end" &&
        (t.status === "ok" || t.status === "changed") &&
        typeof t.taskName === "string",
    )
    .sort((a, b) => a.seq - b.seq);

  const boundarySeq = Math.max(
    ...applied.filter((t) => t.checkpointId === checkpoint).map((t) => t.seq),
    -Infinity,
  );

  const skip = new Set<string>();
  for (const t of applied) {
    if (t.seq >= boundarySeq) skip.add(t.taskName);
  }
  return skip;
}

/** Parsed `--resume` argument. */
export interface ResumeSpec {
  runId: string;
  checkpoint: string;
}

/**
 * Parse a `--resume <run_id>:<checkpoint>` argument. Requires the `<run_id>:<checkpoint>`
 * shape (a missing colon or empty run id is rejected) so a malformed value is caught
 * rather than silently resuming nothing.
 * @param arg Raw CLI value (e.g. "abc123:cp2").
 * @returns The parsed spec, or `null` when the format is unusable.
 */
export function parseResumeArg(arg: string | undefined): ResumeSpec | null {
  if (!arg) return null;
  const idx = arg.indexOf(":");
  if (idx < 0) return null;
  const runId = arg.slice(0, idx);
  const checkpoint = arg.slice(idx + 1);
  if (!runId) return null;
  return { runId, checkpoint };
}
