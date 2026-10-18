// Executor control-flow matrix tests (Todo 12). Bun-only MVP (bun test).
//
// Covers: (a) loop expansion, (b) when:false skip, (c) notify dedupe+ordering,
// (d) ad-hoc single task, (e) failure propagation halts downstream, (f) run_once,
// (g) delegate_to, (h) serial sequential batching, (i) strategy:free isolation,
// (j) register -> templated facts. No real transport: uses built-in debug/assert
// plus throwaway counting/recording modules.

import { expect, test } from "bun:test";
import type { NormalizedInventory, NormalizedPlaybook, NormalizedTask } from "../src/config/schema";
import { registerModule, runPlaybook, runTask } from "../src/executor";

function inventory(hosts: string[]): NormalizedInventory {
  return { groups: { all: { hosts, vars: {} } } };
}

/** Build a NormalizedTask with `notify` defaulted to [] (schema requires it). */
function mkTask(
  p: Omit<NormalizedTask, "notify"> & { notify?: string[] },
): NormalizedTask {
  return { notify: [], ...p };
}

function countingModule(): { name: string; count: () => number } {
  const c = { n: 0 };
  const name = `__count_${Math.random().toString(36).slice(2)}`;
  registerModule({
    name,
    run: async () => {
      c.n++;
      return { changed: false };
    },
  });
  return { name, count: () => c.n };
}

function recordingModule(): { name: string; events: string[] } {
  const events: string[] = [];
  const name = `__rec_${Math.random().toString(36).slice(2)}`;
  registerModule({
    name,
    run: async (ctx) => {
      events.push(`start:${ctx.host}`);
      await Promise.resolve();
      events.push(`end:${ctx.host}`);
      return { changed: false };
    },
  });
  return { name, events };
}

/** A module that always reports `changed: true` (required for `notify` to fire). */
function changingModule(): string {
  const name = `__chg_${Math.random().toString(36).slice(2)}`;
  registerModule({ name, run: async () => ({ changed: true }) });
  return name;
}

// (a) loop expands N iterations, each executed once per target.
test("(a) loop expands N iterations, executed once per target", async () => {
  const pb: NormalizedPlaybook = {
    hosts: ["all"],
    tasks: [
      mkTask({
        name: "t",
        module: "debug",
        args: { msg: "<%= loop.item %>" },
        loop: ["a", "b", "c"],
      }),
    ],
    vars: {},
  };
  const res = await runPlaybook([pb], inventory(["h1", "h2"]));
  for (const h of ["h1", "h2"]) {
    const out = res.hosts[h]![0]!;
    expect(out.iterations.length).toBe(3);
    expect(out.iterations.map((i) => i.item)).toEqual(["a", "b", "c"]);
  }
});

// (b) when:false skips cleanly with no error.
test("(b) when:false skips cleanly; templated when scopes per host", async () => {
  const pb: NormalizedPlaybook = {
    hosts: ["all"],
    tasks: [
      mkTask({ name: "skip", module: "debug", args: {}, when: false }),
      mkTask({
        name: "only-h1",
        module: "debug",
        args: {},
        when: { $eq: [{ $var: "play.host" }, "h1"] },
      }),
    ],
    vars: {},
  };
  const res = await runPlaybook([pb], inventory(["h1", "h2"]));
  expect(res.hosts["h1"]![0]!.iterations[0]!.skipped).toBe(true);
  expect(res.hosts["h1"]![0]!.failed).toBe(false);
  expect(res.hosts["h2"]![0]!.iterations[0]!.skipped).toBe(true);
  // templated when: runs on h1, skipped on h2
  expect(res.hosts["h1"]![1]!.iterations[0]!.skipped).toBe(false);
  expect(res.hosts["h2"]![1]!.iterations[0]!.skipped).toBe(true);
});

// (c) two notifying tasks collapse into ONE handler run, correct ordering.
test("(c) notify dedupes to one handler run, preserves order", async () => {
  const chg = changingModule();
  const pb: NormalizedPlaybook = {
    hosts: ["h1"],
    tasks: [
      mkTask({ name: "t1", module: chg, args: {}, notify: ["restart"] }),
      mkTask({ name: "t2", module: chg, args: {}, notify: ["restart"] }),
      mkTask({ name: "t3", module: chg, args: {}, notify: ["reload"] }),
      mkTask({ name: "do restart", module: "debug", args: {}, listen: "restart" }),
      mkTask({ name: "do reload", module: "debug", args: {}, listen: "reload" }),
    ],
    vars: {},
  };
  const res = await runPlaybook([pb], inventory(["h1"]));
  expect(res.handlers.length).toBe(2);
  expect(res.handlers.map((h) => h.handler)).toEqual(["do restart", "do reload"]);
  // handler tasks are NOT executed in the main loop
  expect(res.hosts["h1"]!.length).toBe(3);
});

// (d) ad-hoc runs a single module successfully.
test("(d) runTask runs a single module successfully", async () => {
  const res = await runTask(
    { name: "a", module: "debug", args: { x: "1" }, hosts: "h1" },
    inventory(["h1", "h2"]),
  );
  expect(res.hosts["h1"]![0]!.module).toBe("debug");
  expect(res.ok).toBe(1);
  expect(res.failed).toBe(0);
});

// (e) a failing task halts its dependent downstream tasks (no silent continue).
test("(e) failure propagation halts downstream tasks on the same host", async () => {
  const pb: NormalizedPlaybook = {
    hosts: ["h1"],
    tasks: [
      mkTask({ name: "fail", module: "assert", args: { that: false } }),
      mkTask({ name: "after", module: "debug", args: {} }),
    ],
    vars: {},
  };
  const res = await runPlaybook([pb], inventory(["h1"]));
  expect(res.hosts["h1"]![0]!.failed).toBe(true);
  expect(res.hosts["h1"]![1]!.skipped).toBe(true);
  expect(res.failed).toBe(1);
  expect(res.skipped).toBe(1);
});

// (f) run_once executes exactly once across all hosts.
test("(f) run_once executes the task a single time", async () => {
  const m = countingModule();
  const pb: NormalizedPlaybook = {
    hosts: ["all"],
    tasks: [mkTask({ name: "t", module: m.name, args: {}, run_once: true })],
    vars: {},
  };
  const res = await runPlaybook([pb], inventory(["h1", "h2", "h3"]));
  expect(m.count()).toBe(1);
  // recorded under the first matched host
  expect(res.hosts["h1"]![0]!.module).toBe(m.name);
});

// (g) delegate_to runs the task against the specified host.
test("(g) delegate_to runs against the specified host, not the play hosts", async () => {
  const pb: NormalizedPlaybook = {
    hosts: ["h1", "h2"],
    tasks: [
      mkTask({ name: "t", module: "debug", args: {}, delegate_to: "h3" }),
    ],
    vars: {},
  };
  const res = await runPlaybook([pb], inventory(["h1", "h2", "h3"]));
  expect(res.hosts["h3"]?.[0]?.host).toBe("h3");
  // the play's own hosts did NOT run the delegated task
  expect(res.hosts["h1"]!.length).toBe(0);
  expect(res.hosts["h2"]!.length).toBe(0);
});

// (h) serial batches process group members sequentially.
test("(h) serial processes hosts sequentially (batches of 1)", async () => {
  const m = recordingModule();
  const pb: NormalizedPlaybook = {
    hosts: ["all"],
    serial: 1,
    tasks: [mkTask({ name: "t", module: m.name, args: {} })],
    vars: {},
  };
  await runPlaybook([pb], inventory(["h1", "h2", "h3"]));
  // sequential: each host's start is immediately followed by its end
  expect(m.events).toEqual([
    "start:h1",
    "end:h1",
    "start:h2",
    "end:h2",
    "start:h3",
    "end:h3",
  ]);
});

// (i) strategy:free runs un-gated parallel with isolated failures.
test("(i) strategy:free isolates failures across hosts", async () => {
  const pb: NormalizedPlaybook = {
    hosts: ["all"],
    strategy: "free",
    tasks: [
      mkTask({
        name: "fail-on-h1",
        module: "assert",
        args: { that: { $template: "<%= play.host === 'h2' %>" } },
      }),
      mkTask({ name: "ok", module: "debug", args: {} }),
    ],
    vars: {},
  };
  const res = await runPlaybook([pb], inventory(["h1", "h2"]));
  // h1 fails its first task and halts its second
  expect(res.hosts["h1"]![0]!.failed).toBe(true);
  expect(res.hosts["h1"]![1]!.skipped).toBe(true);
  // h2 is unaffected and completes both tasks
  expect(res.hosts["h2"]![0]!.failed).toBe(false);
  expect(res.hosts["h2"]![1]!.skipped).toBe(false);
});

// (j) register injects results as facts usable by later tasks via templating.
test("(j) register exposes results to later tasks via templating", async () => {
  const pb: NormalizedPlaybook = {
    hosts: ["h1"],
    tasks: [
      mkTask({
        name: "set",
        module: "debug",
        args: { value: "hello" },
        register: "result",
      }),
      mkTask({
        name: "use",
        module: "debug",
        args: { got: { $template: "<%= reg.result.stdout %>" } },
        register: "result2",
      }),
    ],
    vars: {},
  };
  const res = await runPlaybook([pb], inventory(["h1"]));
  const useTask = res.hosts["h1"]![1]!;
  const got = (useTask.iterations[0]!.data as { args: { got: string } }).args.got;
  expect(got).toContain("hello");
  // registered var is also present in the result map
  expect((res.registered["h1"]!["result"] as { changed: boolean }).changed).toBe(false);
});
