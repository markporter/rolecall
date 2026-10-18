// Layer B — CPU-bound worker pool (util/concurrency.cpuPool / InlineScheduler).
import { describe, expect, test } from "bun:test";
import { cpus } from "node:os";
import { CpuPool, InlineScheduler } from "../src/util/concurrency";

/** A deterministic pure-JS transform used across backend-agnostic assertions. */
const double = (p: unknown): number => (p as number) * 2;
const throwing = (): never => {
  throw new Error("kaboom");
};

describe("InlineScheduler (deterministic, no OS threads)", () => {
  test("round-robin distribution is identical and reproducible across runs", async () => {
    const size = 4;
    const make = () =>
      new InlineScheduler(size);
    const buildTasks = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ payload: i, compute: double }));

    const a = await make().runBatch(buildTasks(13));
    const b = await make().runBatch(buildTasks(13));
    const workersA = a.map((r) => r.worker);
    const workersB = b.map((r) => r.worker);
    expect(workersA).toEqual(workersB);
    // Deterministic round-robin: slot == index % size.
    expect(workersA).toEqual(Array.from({ length: 13 }, (_, i) => i % size));
  });

  test("preserves input order in results regardless of completion order", async () => {
    const sched = new InlineScheduler(3);
    const results = await sched.runBatch(
      Array.from({ length: 9 }, (_, i) => ({
        payload: i,
        compute: (p: unknown) => `v${(p as number)}`,
      })),
    );
    expect(results.map((r) => r.status)).toEqual(Array.from({ length: 9 }, () => "ok"));
    expect(results.map((r) => r.value)).toEqual([
      "v0", "v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8",
    ]);
  });

  test("isolates a crashing job; others still succeed and pool stays usable", async () => {
    const sched = new InlineScheduler(4);
    const tasks = Array.from({ length: 8 }, (_, i) => ({
      payload: i,
      compute: (p: unknown) => {
        if ((p as number) === 3) throw new Error("boom");
        return double(p);
      },
    }));
    const results = await sched.runBatch(tasks);
    const errors = results.filter((r) => r.status === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.index).toBe(3);
    expect(errors[0]!.message).toContain("boom");
    for (let i = 0; i < 8; i++) {
      if (i === 3) continue;
      expect(results[i]!.status).toBe("ok");
      expect(results[i]!.value).toBe(i * 2);
    }
    // Pool usable after an isolated failure.
    const again = await sched.runBatch([{ payload: 100, compute: double }]);
    expect(again[0]!.value).toBe(200);
  });
});

describe("CpuPool sizing & runtime-backed execution", () => {
  test("default pool size equals os.cpus().length", () => {
    const pool = new CpuPool(new InlineScheduler(cpus().length));
    expect(pool.workers).toBe(cpus().length);
    pool.dispose();
  });

  test("configured override sets the exact worker count", () => {
    const pool = new CpuPool(new InlineScheduler(5));
    expect(pool.workers).toBe(5);
    pool.dispose();
  });

  test("cpuPool() routes through a real thread backend with per-run accounting", async () => {
    // Under this environment Bun.workers is absent, so selectDispatcherKind picks
    // node:worker_threads. Use an explicit small override to keep it cheap.
    const pool = new CpuPool(
      (await import("../src/pal/workers")).createWorkerDispatcher("threads", 3),
    );
    const results = await pool.run(
      Array.from({ length: 6 }, (_, i) => ({ payload: i, compute: double })),
    );
    expect(results.map((r) => r.value)).toEqual([0, 2, 4, 6, 8, 10]);
    const stats = pool.stats();
    expect(stats.succeeded).toBe(6);
    expect(stats.failed).toBe(0);
    expect(pool.workers).toBe(3);
    pool.dispose();
  });

  test("threaded backend isolates a failing job without blocking siblings", async () => {
    const dispatcher = (await import("../src/pal/workers")).createWorkerDispatcher("threads", 2);
    const pool = new CpuPool(dispatcher);
    const results = await pool.run(
      [
        { payload: 1, compute: double },
        { payload: undefined, compute: throwing },
        { payload: 3, compute: double },
      ],
    );
    expect(results).toHaveLength(3);
    expect(results[0]!.value).toBe(2);
    expect(results[2]!.value).toBe(6);
    expect(results[1]!.status).toBe("error");
    expect(pool.stats().failed).toBe(1);
    expect(pool.stats().succeeded).toBe(2);
    pool.dispose();
  });
});
