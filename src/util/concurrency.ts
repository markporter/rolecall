// Concurrency layer for RoleCall: two orthogonal layers.
// (A) forkLimiter() - bounded ASYNC host-fanout on the main event loop via a
//     p-limit semaphore; scales to hundreds of hosts, independent of os.cpus().
// (B) cpuPool()     - offloads CPU-bound transforms (template render, hashing) to
//     a small pool sized to os.cpus(); does NOT bound fan-out. Failures isolated.
// Layer B dispatches through a pluggable JobDispatcher (InlineScheduler for tests,
// node:worker_threads / Bun.workers chosen at runtime in src/pal/workers.ts).

import pLimit from "p-limit";
import { cpus } from "node:os";
import { detectRuntime } from "./runtime";
import { createWorkerDispatcher } from "../pal/workers";

// ---------------------------------------------------------------------------
// Layer A — async host-fanout limiter
// ---------------------------------------------------------------------------

/** A bounded-concurrency async limiter over the main event loop. */
export interface ForkLimiter {
  /** Run one async runner; at most `size` runners execute concurrently. */
  run<T>(fn: () => Promise<T>): Promise<T>;
  /** Runners currently executing. */
  readonly activeCount: number;
  /** Runners submitted but waiting for an open slot. */
  readonly pendingCount: number;
  /** Current concurrency ceiling. */
  readonly size: number;
  /** Drop queued-but-not-started runners. */
  clearQueue(): void;
}

// Bounded-concurrency async limiter: `size` caps runners on the main event loop
// (scales to hundreds of hosts, independent of os.cpus()); p-limit semaphore.
export function forkLimiter(opts: { size: number }): ForkLimiter {
  const size = Math.max(1, Math.floor(Number(opts.size)));
  const limit = pLimit(size);
  return {
    get activeCount() {
      return limit.activeCount;
    },
    get pendingCount() {
      return limit.pendingCount;
    },
    get size() {
      return size;
    },
    run<T>(fn: () => Promise<T>) {
      return limit(fn);
    },
    clearQueue() {
      limit.clearQueue();
    },
  };
}

// ---------------------------------------------------------------------------
// Layer B — CPU-bound worker pool
// ---------------------------------------------------------------------------

/** A single CPU-bound unit of work carrying an opaque payload plus a pure transform. */
export interface CpuTask<R> {
  /** Opaque value passed to `compute`; used only for assignment/distribution. */
  payload?: unknown;
  /** Pure-JS transform executed off the main thread. Must not throw out of the worker. */
  compute: (payload: unknown) => R;
}

/** Outcome of one job. Either a value or an isolated error — never rejects the batch. */
export interface JobResult<R> {
  index: number;
  status: "ok" | "error";
  value?: R;
  message?: string;
  /** Zero-based worker/slot id that produced this result. */
  worker: number;
}

/** Observability snapshot for acceptance checks. */
export interface CpuPoolStats {
  workers: number;
  completed: number;
  succeeded: number;
  failed: number;
}

/**
 * Runs a batch of jobs across N slots, preserving input ORDER in the returned
 * results and isolating each job's failure into its own JobResult (never rejecting
 * the whole batch). The dispatcher owns the execution model (inline vs threads).
 */
export interface JobDispatcher {
  readonly kind: "inline" | "threads" | "bunworkers";
  readonly count: number;
  runBatch<R>(tasks: ReadonlyArray<CpuTask<R>>): Promise<JobResult<R>[]>;
  dispose(): void;
}

interface QueueEntry<R> {
  idx: number;
  task: CpuTask<R>;
}

/** Deterministic, dependency-free scheduler used for tests and as the guaranteed fallback. */
export class InlineScheduler implements JobDispatcher {
  readonly kind = "inline" as const;
  readonly count: number;
  #peakActive = 0;

  constructor(count: number) {
    this.count = Math.max(1, Math.floor(count));
  }

  get peakActive(): number {
    return this.#peakActive;
  }

  async runBatch<R>(tasks: ReadonlyArray<CpuTask<R>>): Promise<JobResult<R>[]> {
    const size = this.count;
    // Round-robin assignment i -> i%size; slots simulate a fixed-size pool.
    const buckets: QueueEntry<R>[][] = Array.from({ length: size }, () => []);
    tasks.forEach((task, i) => {
      buckets[i % size]!.push({ idx: i, task });
    });

    const results: JobResult<R>[] = new Array(tasks.length);
    await Promise.all(
      buckets.map(async (bucket) => {
        let concurrent = 0;
        for (const { idx, task } of bucket) {
          concurrent += 1;
          if (concurrent > this.#peakActive) this.#peakActive = concurrent;
          const worker = idx % size;
          try {
            const value = await Promise.resolve().then(() => task.compute(task.payload));
            results[idx] = { index: idx, status: "ok", value, worker };
          } catch (err) {
            results[idx] = {
              index: idx,
              status: "error",
              message: err instanceof Error ? err.message : String(err),
              worker,
            };
          } finally {
            concurrent -= 1;
          }
        }
      }),
    );
    return results;
  }

  dispose() {}
}

/** Worker-pool facade over a JobDispatcher with per-run accounting + teardown. */
export class CpuPool {
  readonly #dispatcher: JobDispatcher;
  #disposed = false;
  #completed = 0;
  #succeeded = 0;
  #failed = 0;

  constructor(dispatcher: JobDispatcher) {
    this.#dispatcher = dispatcher;
  }

  /** Number of worker slots == os.cpus() by default, or the configured override. */
  get workers(): number {
    return this.#dispatcher.count;
  }

  /** Execution-model label of the backing dispatcher. */
  get kind(): string {
    return this.#dispatcher.kind;
  }

  /** Run a batch; preserves input order; isolates each failing job into its own result. */
  async run<R>(tasks: ReadonlyArray<CpuTask<R>>): Promise<JobResult<R>[]> {
    if (this.#disposed) throw new Error("CpuPool disposed");
    const results = await this.#dispatcher.runBatch(tasks);
    for (const r of results) {
      this.#completed += 1;
      if (r.status === "ok") this.#succeeded += 1;
      else this.#failed += 1;
    }
    return results;
  }

  /** Submit exactly one job; resolves to its single (isolated) result. */
  submit<R>(task: CpuTask<R>): Promise<JobResult<R>> {
    return this.run([task]).then((res) => res[0]!);
  }

  /** Current accumulation stats since construction. */
  stats(): CpuPoolStats {
    return {
      workers: this.workers,
      completed: this.#completed,
      succeeded: this.#succeeded,
      failed: this.#failed,
    };
  }

  /** Release the backing dispatcher (workers/threads). Idempotent. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#dispatcher.dispose();
  }
}

// Pick the CPU-worker backend (Bun-primary PAL convention): ROLECALL_RUNTIME=node ->
// node:worker_threads; bun + Bun.workers present -> native Bun workers; else
// node:worker_threads, finally the deterministic inline scheduler. node:cluster is
// Linux-only (SO_REUSEPORT), so we use explicit threads / Bun.workers instead.
export type DispatcherKind = "inline" | "threads" | "bunworkers";

export function selectDispatcherKind(): DispatcherKind {
  const override = detectRuntime().name;
  if (override === "node") return "threads";
  const maybeBun = globalThis.Bun as { workers?: unknown } | undefined;
  const bunWorkersAvailable = typeof maybeBun?.workers === "function";
  if (override === "bun" && bunWorkersAvailable) return "bunworkers";
  return "threads";
}

// CPU-bound worker pool sized to os.cpus() by default (or opts.workers). Dispatches
// through the runtime-selected backend, degrading to the deterministic inline
// scheduler when real workers can't be created — always usable, threaded when possible.
export function cpuPool(opts: { workers?: number } = {}): CpuPool {
  const count = opts.workers != null ? Math.max(1, Math.floor(Number(opts.workers))) : cpus().length;
  const dispatcher = createDefaultDispatcher(count);
  return new CpuPool(dispatcher);
}

/** Create the runtime-selected dispatcher, degrading gracefully to the inline scheduler. */
export function createDefaultDispatcher(count: number): JobDispatcher {
  const kind = selectDispatcherKind();
  try {
    return createWorkerDispatcher(kind, count);
  } catch {
    // No real workers available in this environment -> deterministic inline fallback.
    return new InlineScheduler(count);
  }
}
