// Layer A — async host-fanout limiter (util/concurrency.forkLimiter).
import { describe, expect, test } from "bun:test";
import { cpus } from "node:os";
import { forkLimiter } from "../src/util/concurrency";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("forkLimiter", () => {
  test("caps concurrent runners at K while completing every job", async () => {
    const lim = forkLimiter({ size: 4 });
    let active = 0;
    let peak = 0;
    const N = 40;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        lim.run(async () => {
          active += 1;
          if (active > peak) peak = active;
          await sleep(5);
          active -= 1;
          return i;
        }),
      ),
    );
    expect(results).toEqual(Array.from({ length: N }, (_, i) => i));
    expect(peak).toBe(4); // never exceeded the ceiling
    expect(lim.activeCount).toBe(0);
    expect(lim.pendingCount).toBe(0);
  });

  test("K is honored independently of os.cpus()", async () => {
    const ncpus = cpus().length;
    // Ceiling far below CPU count.
    const small = forkLimiter({ size: 2 });
    let peak = 0;
    let active = 0;
    await Promise.all(
      Array.from({ length: 12 }, () =>
        small.run(async () => {
          active += 1;
          peak = Math.max(peak, active);
          await sleep(3);
          active -= 1;
        }),
      ),
    );
    expect(peak).toBe(2);

    // Ceiling far above CPU count — still honored exactly, not clamped to cpus.
    const bigCeil = Math.max(ncpus + 50, 100);
    const big = forkLimiter({ size: bigCeil });
    let bigActive = 0;
    let bigPeak = 0;
    await Promise.all(
      Array.from({ length: 10 }, () =>
        big.run(async () => {
          bigActive += 1;
          bigPeak = Math.max(bigPeak, bigActive);
          await sleep(2);
          bigActive -= 1;
        }),
      ),
    );
    expect(big.size).toBe(bigCeil);
    expect(bigPeak).toBeLessThanOrEqual(bigCeil);
    expect(bigActive).toBe(0);
  });

  test("scales to hundreds of hosts without unbounded fan-out blowup", async () => {
    const lim = forkLimiter({ size: 200 });
    const M = 500;
    let concurrent = 0;
    let peak = 0;
    const start = Date.now();
    const results = await Promise.all(
      Array.from({ length: M }, (_, i) =>
        lim.run(async () => {
          concurrent += 1;
          peak = Math.max(peak, concurrent);
          await sleep(1);
          concurrent -= 1;
          return i * 2;
        }),
      ),
    );
    expect(results.length).toBe(M);
    expect(peak).toBe(200); // exact ceiling held across all M submissions
    // Wall time bounded by ceil(M/200)*unit, NOT M*unit — proves backpressure works.
    expect(Date.now() - start).toBeLessThan(5_000);
  });

  test("N fanned-out tasks finish faster than serial even when cpus()==8-ish", async () => {
    const unit = 15; // ms per yielded task
    const N = 48;
    const forks = 6;

    // Serial baseline: run each task one-at-a-time on the main loop.
    const serialStart = Date.now();
    for (let i = 0; i < N; i++) {
      await Promise.all([
        new Promise<void>((r) => setTimeout(() => r(), unit)),
        new Promise<void>((r) => setTimeout(() => r(), unit)),
      ]);
    }
    const serialMs = Date.now() - serialStart;

    // Parallel fan-out via the async limiter with a fixed ceiling.
    const lim = forkLimiter({ size: forks });
    const parStart = Date.now();
    await Promise.all(
      Array.from({ length: N }, () =>
        lim.run(async () => {
          await Promise.all([sleep(unit), sleep(unit)]);
        }),
      ),
    );
    const parallelMs = Date.now() - parStart;

    // Fan-out must be dramatically cheaper than serial regardless of core count.
    expect(parallelMs).toBeLessThan(serialMs * 0.7);
    expect(serialMs).toBeGreaterThan(500);
  });

  test("clearQueue discards pending-but-not-started runners", async () => {
    const lim = forkLimiter({ size: 1 });
    let started = 0;
    const gate = new Promise<void>((r) => setTimeout(r, 40));
    const p1 = lim.run(async () => {
      started += 1;
      await gate;
    });
    await sleep(5);
    const queued = [lim.run(async () => started += 1), lim.run(async () => started += 1)];
    expect(lim.pendingCount).toBe(2);
    lim.clearQueue();
    expect(lim.pendingCount).toBe(0);
    await gate;
    await p1;
    // Cleared runners are discarded and may never settle; bound the wait.
    await Promise.race([Promise.allSettled(queued), sleep(20)]);
    expect(started).toBe(1); // only the first runner ever ran
  });
});
