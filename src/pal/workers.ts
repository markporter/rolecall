// Cross-runtime CPU-worker backend for RoleCall (Layer B dispatch).
//
// Two execution models share ONE contract (JobDispatcher from util/concurrency.ts):
//   - NodeThreadsDispatcher : node:worker_threads (standard on Node AND Bun here).
//   - BunWorkersDispatcher  : Bun.workers(count, ...opts) native workers.
//
// Both run arbitrary PURE-JS transforms off the main loop by sending the compute
// function's source string plus a structured payload to a fixed-size pool of N
// workers (N == os.cpus() by default). A throwing transform becomes an ERROR
// envelope inside the worker instead of escaping — so one bad job cannot take down
// its slot or siblings. Results are reassembled in INPUT ORDER regardless of the
// order messages arrive, giving deterministic work-distribution outcomes under both
// runtimes. NOTE: node:cluster is Linux-only (SO_REUSEPORT / affinity gaps), so we
// use explicit threads / Bun.workers instead.

import { Worker } from "node:worker_threads";
import type { CpuTask, JobDispatcher, JobResult } from "../util/concurrency";

const BOOTSTRAP_SRC = String.raw`
import { parentPort } from 'node:worker_threads';
parentPort.on('message', (msg) => {
  if (msg && msg.__ready) return;
  try {
    const fn = new Function('payload', msg.src);
    parentPort.postMessage({ seq: msg.seq, ok: true, value: fn(msg.payload) });
  } catch (err) {
    parentPort.postMessage({ seq: msg.seq, ok: false, message: err instanceof Error ? err.message : String(err) });
  }
});
parentPort.postMessage({ __ready: true });
`;

/**
 * Emit a function BODY that evaluates the user transform against `payload` and
 * returns its result, via `new Function("payload", body)` on each worker. Any
 * throw propagates to the caller (the worker bootstrap's own try/catch turns it
 * into an ERROR envelope), so one bad job never kills the worker slot.
 */
function wrapSource<R>(task: CpuTask<R>): string {
  const src = typeof task.compute === "function" ? task.compute.toString() : "";
  return `return ((${src})(payload));`;
}

type MsgHandler = (raw: { seq?: number; ok?: boolean; value?: unknown; message?: string }) => void;

type DispatchableWorker = {
  on: (ev: string, cb: MsgHandler) => void;
  postMessage: (m: unknown) => void;
};

/** Reassemble ordered results across slots; resolves when every task has answered. */
function orderedResolve<R>(
  tasks: readonly CpuTask<R>[],
  size: number,
  workers: ReadonlyArray<DispatchableWorker | null>,
): Promise<JobResult<R>[]> {
  const n = tasks.length;
  const results: JobResult<R>[] = new Array(n);
  return new Promise((resolve) => {
    if (n === 0) {
      resolve(results);
      return;
    }
    let pending = n;
    const safety = setTimeout(() => {
      clearTimeout(safety);
      resolve(results);
    }, 30_000);
    if (typeof (safety as unknown as { unref?: () => void }).unref === "function")
      (safety as unknown as { unref: () => void }).unref();
    for (let slot = 0; slot < size; slot++) {
      const w = workers[slot];
      if (!w) continue;
      w.on("message", (raw) => {
        const idx = raw!.seq!;
        results[idx] = raw!.ok
          ? { index: idx, status: "ok", value: raw!.value as R, worker: idx % size }
          : { index: idx, status: "error", message: raw!.message, worker: idx % size };
        if (--pending === 0) {
          clearTimeout(safety);
          resolve(results);
        }
      });
    }
    for (let i = 0; i < n; i++) {
      const task = tasks[i];
      if (!task) continue;
      const slot = i % size;
      workers[slot]?.postMessage({ seq: i, src: wrapSource(task), payload: task.payload });
    }
  });
}

// ---------------------------------------------------------------------------
// node:worker_threads backend
// ---------------------------------------------------------------------------

class NodeThreadsDispatcher implements JobDispatcher {
  readonly kind = "threads" as const;
  readonly count: number;
  #workers: Worker[];
  #created = 0;
  #ready: Promise<void>;

  constructor(count: number) {
    this.count = Math.max(1, Math.floor(count));
    this.#workers = [];
    const readySignals: Promise<void>[] = [];
    for (let i = 0; i < this.count; i++) {
      const worker = new Worker(
        `data:text/javascript;base64,${Buffer.from(BOOTSTRAP_SRC).toString("base64")}`,
      );
      this.#created += 1;
      this.#workers.push(worker);
      readySignals.push(
        new Promise((resolve) => {
          worker.on("message", (m: { __ready?: boolean }) => {
            if (m?.__ready) resolve();
          });
          worker.on("error", () => resolve());
        }),
      );
    }
    this.#ready = Promise.allSettled(readySignals).then(() => undefined);
  }

  get created(): number {
    return this.#created;
  }

  async runBatch<R>(tasks: ReadonlyArray<CpuTask<R>>): Promise<JobResult<R>[]> {
    await this.#ready;
    return orderedResolve(tasks, this.count, this.#workers);
  }

  dispose(): void {
    for (const w of this.#workers) w.terminate();
  }
}

// ---------------------------------------------------------------------------
// Bun.workers native backend (constructed only when Bun.workers is present)
// ---------------------------------------------------------------------------

interface BunWorkerLike extends DispatchableWorker {
  terminate(): void;
}

class BunWorkersDispatcher implements JobDispatcher {
  readonly kind = "bunworkers" as const;
  readonly count: number;
  #workers: BunWorkerLike[];

  constructor(count: number) {
    this.count = Math.max(1, Math.floor(count));
    const B = globalThis.Bun as unknown as {
      workers: (n: number, opts?: Record<string, unknown>) => BunWorkerLike[];
    };
    // Bun's worker_threads is partial — pass only supported opts (see issues.md).
    this.#workers = B.workers(this.count, {});
  }

  runBatch<R>(tasks: ReadonlyArray<CpuTask<R>>): Promise<JobResult<R>[]> {
    return orderedResolve(tasks, this.count, this.#workers);
  }

  dispose(): void {
    for (const w of this.#workers) w.terminate();
  }
}

/** Select and construct the dispatcher for the requested runtime kind. */
export function createWorkerDispatcher(kind: string, count: number): JobDispatcher {
  if (kind === "bunworkers") {
    const maybeBun = globalThis.Bun as { workers?: unknown } | undefined;
    const hasBunWorkers = typeof maybeBun?.workers === "function";
    if (!hasBunWorkers) throw new Error("Bun.workers not available in this runtime");
    return new BunWorkersDispatcher(count);
  }
  return new NodeThreadsDispatcher(count);
}
