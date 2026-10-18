// Layer B — cross-runtime worker routing (util/concurrency.selectDispatcherKind + pal/workers).
import { afterEach, describe, expect, test } from "bun:test";
import { cpus } from "node:os";
import { InlineScheduler } from "../src/util/concurrency";
import type { JobDispatcher } from "../src/util/concurrency";
import { selectDispatcherKind } from "../src/util/concurrency";
import { createWorkerDispatcher } from "../src/pal/workers";

/** Route every message posted to a fake worker back to its slot listener async. */
function makeFakeWorker(): {
  on: (ev: string, cb: (m: unknown) => void) => void;
  postMessage: (d: unknown) => void;
  terminate: () => void;
} {
  let cb: (m: unknown) => void = () => {};
  return {
    on: (_ev, handler) => {
      cb = handler;
    },
    postMessage: (d) => queueMicrotask(() => cb(d)),
    terminate: () => {},
  };
}

describe("selectDispatcherKind routing", () => {
  const original = process.env["ROLECALL_RUNTIME"];
  afterEach(() => {
    if (original === undefined) delete process.env["ROLECALL_RUNTIME"];
    else process.env["ROLECALL_RUNTIME"] = original;
  });

  test("forces node backend under ROLECALL_RUNTIME=node", () => {
    process.env["ROLECALL_RUNTIME"] = "node";
    expect(selectDispatcherKind()).toBe("threads");
  });

  test("routes to native Bun workers ONLY when Bun.workers is present", () => {
    const saved = (globalThis as { Bun?: { workers?: unknown } }).Bun?.workers;
    (globalThis as { Bun?: { workers?: unknown } }).Bun!.workers = (() => []) as never;
    try {
      process.env["ROLECALL_RUNTIME"] = "bun";
      expect(selectDispatcherKind()).toBe("bunworkers");
    } finally {
      if (saved === undefined) delete (globalThis as { Bun?: { workers?: unknown } }).Bun!.workers;
      else (globalThis as { Bun?: { workers?: unknown } }).Bun!.workers = saved;
    }
  });

  test("selects threads unless native Bun.workers is available", () => {
    const maybeBun = globalThis.Bun as { workers?: unknown } | undefined;
    const hasWorkers = maybeBun && typeof maybeBun.workers === "function";
    process.env["ROLECALL_RUNTIME"] = "bun";
    // Deterministic either way: branches on actual runtime capability.
    expect(selectDispatcherKind()).toBe(hasWorkers ? "bunworkers" : "threads");
  });
});

describe("createWorkerDispatcher construction & thread count", () => {
  test("thread dispatcher instantiates exactly os.cpus() Workers by default size", () => {
    const expected = cpus().length;
    const d = createWorkerDispatcher("threads", expected);
    expect(d.kind).toBe("threads");
    expect(d.count).toBe(expected);
    expect((d as unknown as { created?: number }).created).toBe(expected);
    d.dispose();
  });

  test("configured override yields that many real worker slots", async () => {
    const d = createWorkerDispatcher("threads", 3);
    expect(d.count).toBe(3);
    expect((d as unknown as { created?: number }).created).toBe(3);
    d.dispose();
  });

  test("bunworkers factory selects the native kind and honors the count guard", () => {
    const saved = (globalThis as { Bun?: { workers?: unknown } }).Bun?.workers;
    (globalThis as { Bun?: { workers?: unknown } }).Bun!.workers = (() => [makeFakeWorker(), makeFakeWorker()]) as never;
    try {
      const d = createWorkerDispatcher("bunworkers", 2);
      expect(d.kind).toBe("bunworkers");
      expect(d.count).toBe(2);
    } finally {
      if (saved === undefined) delete (globalThis as { Bun?: { workers?: unknown } }).Bun!.workers;
      else (globalThis as { Bun?: { workers?: unknown } }).Bun!.workers = saved;
    }
  });

  test("bunworkers factory throws when Bun.workers cannot be created", () => {
    // Force absence so the guard path runs deterministically regardless of host.
    const target = globalThis as { Bun?: { workers?: unknown } };
    const saved = target.Bun?.workers;
    if (target.Bun) delete target.Bun.workers;
    try {
      expect(() => createWorkerDispatcher("bunworkers", 1)).toThrow(/Bun.workers/);
    } finally {
      if (saved !== undefined) target.Bun!.workers = saved;
    }
  });
});

describe("identical work-distribution outcome across backends", () => {
  const transform = (p: unknown): string => `n${(p as number) ** 2}`;
  const buildTasks = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ payload: i, compute: transform }));

  test("inline scheduler and threaded worker pool produce identical ordered results", async () => {
    const tasks = buildTasks(9);
    const inlineRes = await new InlineScheduler(4).runBatch(tasks);
    const threaded = createWorkerDispatcher("threads", 4);
    const threadedRes = await threaded.runBatch(tasks);
    threaded.dispose();

    const inlineValues = inlineRes.map((r) => r.value);
    const threadedValues = threadedRes.map((r) => r.value);
    expect(threadedValues).toEqual(inlineValues);
    expect(threadedValues).toEqual(["n0", "n1", "n4", "n9", "n16", "n25", "n36", "n49", "n64"]);
    // Round-robin assignment identical on both backends.
    expect(threadedRes.map((r) => r.worker)).toEqual(Array.from({ length: 9 }, (_, i) => i % 4));
  });

  test("pure-JS deterministic transform is reproducible under node for pure-JS portions", async () => {
    const d = createWorkerDispatcher("threads", 3) as JobDispatcher;
    const runA = await d.runBatch(buildTasks(7));
    const runB = await d.runBatch(buildTasks(7));
    d.dispose();
    expect(runA.map((r) => r.value)).toEqual(runB.map((r) => r.value));
    expect(runA.every((r) => r.status === "ok")).toBe(true);
  });
});
