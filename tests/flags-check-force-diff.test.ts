// Global --check / --force / --diff plumbing + server check-mode tests.
//
// Covers: (a) check mode never converges a CheckableModule and reports
// would-change; (b) check mode skips modules that do not declare support;
// (c) modules declaring supportsCheck receive `_check` and stay dry; (d) --force
// bypasses an already-desired resource; (e) --diff attaches a patch; (f) the
// orchestrator engine honors check=true without mutating target state.

import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerModule, runPlaybook } from "../src/executor";
import type { NormalizedInventory, NormalizedPlaybook, NormalizedTask } from "../src/config/schema";
import { registerAllModules } from "../src/modules/builtins";
import { createConnection } from "../src/transport";
import type { Connection } from "../src/transport";
import { resource } from "../src/modules/resource";
import { Engine } from "../src/orchestrator";
import { validateRunJob } from "../src/orchestrator/job-validation";

registerAllModules();

const cleanup: string[] = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rolecall-flags-"));
  cleanup.push(dir);
  return dir;
}

function inventory(hosts: string[]): NormalizedInventory {
  return { groups: { all: { hosts, vars: {} } } };
}

function mkTask(task: Omit<NormalizedTask, "notify"> & { notify?: string[] }): NormalizedTask {
  return { notify: [], ...task };
}

function local(): () => Connection {
  return () => createConnection({ kind: "local", host: "localhost", user: process.env.USER ?? "ci" });
}

function unique(prefix: string): string {
  return `__flags_${prefix}_${Math.random().toString(36).slice(2)}`;
}

test("(a) check mode reports would-change without converging", async () => {
  let converges = 0;
  const name = unique("checkable");
  registerModule(
    resource({
      name,
      describe: async () => ({ current: "old", inDesired: false }),
      converge: async () => {
        converges++;
        return { changed: true, msg: "converged" };
      },
    }),
  );

  const pb: NormalizedPlaybook = {
    hosts: ["all"],
    tasks: [mkTask({ name: "t", module: name, args: {} })],
  };
  const res = await runPlaybook([pb], inventory(["h1"]), { check: true, diff: true });
  const iter = res.hosts["h1"]![0]!.iterations[0]!;
  expect(converges).toBe(0);
  expect(iter.changed).toBe(true);
  expect(iter.msg).toContain("would change");
  const diff = iter.data?.["diff"] as { before?: unknown; after?: unknown; patch?: string } | undefined;
  expect(diff?.before).toBe("old");
  expect(typeof diff?.patch).toBe("string");
  expect(diff?.patch).toContain("+");
});

test("(b) check mode skips modules without check support", async () => {
  let runs = 0;
  const name = unique("unsupported");
  registerModule({
    name,
    run: async () => {
      runs++;
      return { changed: true };
    },
  });

  const pb: NormalizedPlaybook = {
    hosts: ["all"],
    tasks: [mkTask({ name: "t", module: name, args: {} })],
  };
  const res = await runPlaybook([pb], inventory(["h1"]), { check: true });
  const iter = res.hosts["h1"]![0]!.iterations[0]!;
  expect(runs).toBe(0);
  expect(iter.skipped).toBe(true);
  expect(iter.msg).toContain("check mode not supported");
});

test("(c) supportsCheck modules receive _check and stay dry", async () => {
  let dryRuns = 0;
  let mutations = 0;
  const name = unique("supports");
  registerModule({
    name,
    supportsCheck: true,
    run: async (ctx) => {
      if (ctx.args["_check"] === true) {
        dryRuns++;
        return { changed: false, data: { dryRun: true } };
      }
      mutations++;
      return { changed: true };
    },
  });

  const pb: NormalizedPlaybook = {
    hosts: ["all"],
    tasks: [mkTask({ name: "t", module: name, args: {} })],
  };
  const res = await runPlaybook([pb], inventory(["h1"]), { check: true });
  const iter = res.hosts["h1"]![0]!.iterations[0]!;
  expect(dryRuns).toBe(1);
  expect(mutations).toBe(0);
  expect(iter.changed).toBe(true);
});

test("(d) --force bypasses an already-desired resource", async () => {
  let converges = 0;
  const name = unique("force");
  registerModule(
    resource({
      name,
      describe: async () => ({ current: "same", inDesired: true }),
      converge: async () => {
        converges++;
        return { changed: true };
      },
    }),
  );

  const pb: NormalizedPlaybook = {
    hosts: ["all"],
    tasks: [mkTask({ name: "t", module: name, args: {} })],
  };
  await runPlaybook([pb], inventory(["h1"]), {});
  expect(converges).toBe(0);
  const forced = await runPlaybook([pb], inventory(["h1"]), { force: true });
  expect(converges).toBe(1);
  expect(forced.hosts["h1"]![0]!.changed).toBe(true);
});

test("(e) copy --check writes nothing and --diff emits a patch", async () => {
  const dir = tmpDir();
  const dest = join(dir, "managed.conf");
  const pb: NormalizedPlaybook = {
    hosts: ["all"],
    tasks: [
      mkTask({
        name: "copy",
        module: "copy",
        args: { dest, content: "port=8080\n" },
      }),
    ],
  };
  const res = await runPlaybook([pb], inventory(["h1"]), {
    connectionFor: local(),
    check: true,
    diff: true,
  });
  expect(existsSync(dest)).toBe(false);
  const iter = res.hosts["h1"]![0]!.iterations[0]!;
  expect(iter.changed).toBe(true);
  expect(iter.msg).toContain("would change");
  const diff = iter.data?.["diff"] as { patch?: string } | undefined;
  expect(typeof diff?.patch).toBe("string");
});

test("(f) orchestrator engine check=true never runs the command", async () => {
  const dir = tmpDir();
  const marker = join(dir, "should-not-exist");
  const engine = new Engine(undefined, [
    { name: "h1", kind: "local", host: "localhost", user: process.env.USER ?? "ci" },
  ]);
  const id = engine.enqueue({
    type: "adhoc",
    module: "command",
    targets: ["h1"],
    args: { command: `touch ${marker}` },
    check: true,
    diff: true,
  });
  for (let i = 0; i < 100 && engine.get(id)?.status !== "success"; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  const rec = engine.get(id)!;
  expect(rec.status).toBe("success");
  expect(existsSync(marker)).toBe(false);
  expect(rec.outcomes[0]?.changed).toBe(true);
  expect(rec.outcomes[0]?.summary).toContain("would run");
});

test("(g) job validation preserves check/diff", () => {
  const v = validateRunJob({ type: "adhoc", module: "ping", check: true, diff: true });
  expect(v.ok).toBe(true);
  if (v.ok) {
    expect(v.value.check).toBe(true);
    expect(v.value.diff).toBe(true);
  }
});
