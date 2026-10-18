// Run trace + replay + profiling commands (Todo 25).
//
// `run replay <id>` re-emits a stored run's execution-trace ledger (loaded from
// the durable store) for human or json inspection. Shared helpers (`makeTraceSink`,
// `computeProfile`) are reused by `playbook run` so `--trace` persists a ledger and
// `--profile` prints a per-host/per-task wall-clock summary.

import { openStore } from "../../store";
import type { RunTrace, Store } from "../../store/types";
import type { TraceSink } from "../../executor/context";
import { CliError, type CliResult, type GlobalFlags } from "../types";

/** @summary Build a trace sink that persists every emitted RunTrace into the store under `runId`. @param store Open store whose `traces` repository receives rows. @param runId Run identifier tagging each persisted trace. @returns A TraceSink suitable for ExecOptions.trace; fire-and-forget (errors swallowed). */
export function makeTraceSink(store: Store, runId: string): TraceSink {
  return (t: RunTrace): void => {
    void store.traces
      .create({
        runId: t.runId || runId,
        host: t.host,
        taskName: t.taskName,
        iteration: t.iteration,
        phase: t.phase,
        status: t.status,
        startedAt: t.startedAt,
        endedAt: t.endedAt,
        durationMs: t.durationMs,
        txId: t.txId,
        checkpointId: t.checkpointId,
        detail: t.detail,
      })
      .catch(() => undefined);
  };
}

/** @summary Aggregate end-phase traces into per-host wall-clock timing + failure counts. @param traces RunTrace rows (typically a run's full ledger). @returns Map of host -> { tasks, totalMs, failed }. */
export function computeProfile(
  traces: RunTrace[],
): Record<string, { tasks: number; totalMs: number; failed: number }> {
  const out: Record<string, { tasks: number; totalMs: number; failed: number }> = {};
  for (const t of traces) {
    if (t.phase !== "end") continue;
    const e = (out[t.host] ??= { tasks: 0, totalMs: 0, failed: 0 });
    e.tasks += 1;
    e.totalMs += t.durationMs ?? 0;
    if (t.status === "failed") e.failed += 1;
  }
  return out;
}

/** @summary Render a compact per-host profile summary line (human output). @param profile Per-host aggregation from computeProfile. @returns Multi-line human-readable summary. */
export function formatProfile(
  profile: Record<string, { tasks: number; totalMs: number; failed: number }>,
): string {
  const hosts = Object.keys(profile).sort();
  if (hosts.length === 0) return "  (no trace events)";
  const lines: string[] = [];
  for (const h of hosts) {
    const p = profile[h]!;
    lines.push(`  ${h}: tasks=${p.tasks} totalMs=${p.totalMs} failed=${p.failed}`);
  }
  return lines.join("\n");
}

/**
 * `rolecall run replay <id>` — load a stored run + its trace ledger and re-emit it.
 * @param sub Must be "replay".
 * @param rest `[id]` — the run identifier to replay.
 * @param flags Parsed global flags (controls -o human|json).
 */
export async function runReplayCommand(
  sub: string | undefined,
  rest: string[],
  _flags: GlobalFlags,
): Promise<CliResult> {
  if (sub !== "replay") {
    throw new CliError(true, `unknown run subcommand '${sub ?? ""}' (expected: replay)`);
  }
  const id = rest[0];
  if (!id) {
    throw new CliError(true, "run replay requires a <id> argument");
  }

  const store = openStore();
  try {
    const run = await store.runs.get(id);
    const traces = await store.traces.listByRun(id);
    const profile = computeProfile(traces);
    return {
      command: "run replay",
      runId: id,
      found: run !== null,
      traces,
      profile,
      note: run
        ? `replaying ${traces.length} trace event(s) for stored run`
        : "run not found in store; replaying trace ledger only",
    };
  } finally {
    store.close();
  }
}
