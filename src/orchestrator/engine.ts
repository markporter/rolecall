// Orchestrator execution engine (Task 18 + ADR 0017).
//
// The serve orchestrator never runs playbooks in-process. Each job is forked to
// the one-shot CLI (`rolecall playbook run … -o jsonl`) with a materialized
// temporary playbook/inventory pair. The child therefore gets fresh resolver,
// facts, module, and search state, while the parent parses the typed event /
// result stream for progress, outcomes, and run-trace rows. This is the exact
// CLI execution path users already run, so roles, phases, when/loop, handlers,
// modules, check/diff/force, and tx/checkpoint all apply to server runs.

import { randomUUID } from "node:crypto";

import type { Store } from "../store";
import type { JobBody, RunRecord, SchedulerApi, ServerOptions, TargetDescriptor } from "./types";
import { childArgs, materializeChildRun, resolveChildCommand, runChild, type ChildEvent } from "./child-run";

const DEFAULT_CHILD_TIMEOUT_MS = 15 * 60_000;

export class Engine {
  readonly #fleet = new Map<string, TargetDescriptor>();
  readonly #runs = new Map<string, RunRecord>();
  readonly #inflight = new Set<Promise<void>>();
  readonly #store?: Store;
  readonly #scheduler?: SchedulerApi;
  readonly #childCommand: string[];
  readonly #childTimeoutMs: number;
  #draining = false;

  constructor(store?: Store, fleet?: TargetDescriptor[], scheduler?: SchedulerApi, opts?: ServerOptions) {
    this.#store = store;
    this.#scheduler = scheduler;
    this.#childCommand = resolveChildCommand(opts?.childCli);
    this.#childTimeoutMs = opts?.childTimeoutMs ?? DEFAULT_CHILD_TIMEOUT_MS;
    if (fleet) this.registerFleet(fleet);
  }

  /** Drain flag: once true, new runs are rejected (set during graceful shutdown). */
  setDraining(v: boolean): void { this.#draining = v; }
  isDraining(): boolean { return this.#draining; }

  registerFleet(targets: TargetDescriptor[]): void {
    for (const t of targets) this.#fleet.set(t.name, t);
  }

  /** Number of runs currently executing (for status/drain bookkeeping). */
  active(): number {
    return this.#inflight.size;
  }

  get(id: string): RunRecord | undefined {
    return this.#runs.get(id);
  }

  list(): RunRecord[] {
    return [...this.#runs.values()];
  }

  // --- enqueue --------------------------------------------------------------

  enqueue(body: JobBody): string {
    if (this.#draining) throw new Error("server is draining — accepting no new runs");
    if (body.type !== "playbook" && body.type !== "adhoc" && body.type !== "nonIdempotent") {
      throw new Error(`invalid job type '${String(body.type)}'`);
    }
    const id = randomUUID();
    const rec: RunRecord = { id, jobType: body.type, status: "queued", startedAt: Date.now(), outcomes: [], dispatchCount: 0 };
    // Insert synchronously BEFORE awaiting -> poll sees 'queued' immediately.
    this.#runs.set(id, rec);
    this.#persistStart(rec, body);
    const task = this.#dispatch(body, rec);
    this.#inflight.add(task);
    task.finally(() => this.#inflight.delete(task));
    return id;
  }

  async #dispatch(body: JobBody, rec: RunRecord): Promise<void> {
    rec.status = "running";
    this.#persistStatus(rec, "running");
    let materialized: Awaited<ReturnType<typeof materializeChildRun>> | undefined;
    try {
      materialized = await materializeChildRun(body, this.#fleet);
      const result = await runChild(this.#childCommand, childArgs(body, materialized), {
        cwd: process.cwd(),
        timeoutMs: this.#childTimeoutMs,
      });
      for (const event of result.events) this.#traceEvent(rec.id, event);

      rec.outcomes = result.outcomes;
      rec.dispatchCount = result.outcomes.length;
      const ok = result.exitCode === 0 && result.outcomes.every((o) => o.ok);
      rec.status = ok ? "success" : "failed";
      rec.error = ok
        ? undefined
        : result.stderr.trim() || `${result.outcomes.filter((o) => !o.ok).length} failing target(s)`;
      this.#persistStatus(rec, rec.status, ok ? "completed" : undefined);
    } catch (err) {
      rec.status = "failed";
      rec.error = err instanceof Error ? err.message : String(err);
      this.#persistStatus(rec, "failed", undefined);
    } finally {
      materialized?.cleanup();
    }
  }

  /** Best-effort persistence of child task events into the durable trace ledger. */
  #traceEvent(runId: string, event: ChildEvent): void {
    const store = this.#store;
    if (!store) return;
    const at = Date.parse(event.ts);
    const timestamp = Number.isFinite(at) ? at : Date.now();
    void store.traces.create({
      runId,
      host: event.host,
      taskName: event.task,
      iteration: -1,
      phase: "end",
      status: event.status === "changed" ? "ok" : event.status,
      startedAt: timestamp,
      endedAt: timestamp,
      durationMs: null,
      detail: { module: event.module, ...(event.msg ? { msg: event.msg } : {}), changed: event.status === "changed" },
    }).catch(() => undefined);
  }

  // --- persistence (best-effort through the durable store) ------------------

  #persistStart(rec: RunRecord, body: JobBody): void {
    const store = this.#store;
    if (!store) return;
    try {
      void store.runs.create({ id: rec.id, actionType: rec.jobType, targetIds: [], status: "queued", startedAt: rec.startedAt, payload: body as unknown as Record<string, unknown> }).catch(() => undefined);
    } catch { /* in-memory record is authoritative */ }
  }

  #persistStatus(rec: RunRecord, status: import("./types").RunStatus, summary?: string): void {
    const store = this.#store;
    if (!store) return;
    void store.runs.update(rec.id, { status, resultSummary: summary, finishedAt: status === "success" || status === "failed" ? Date.now() : undefined }).catch(() => undefined);
  }
}
