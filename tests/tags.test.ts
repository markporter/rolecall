// Task/play `tags:` + global `--tags` / `--skip-tags` selection tests
// (ansible-compatibility-roadmap Wave 3, P13 tags).
//
// Rules under test:
//   - a task's effective tags are its OWN `tags:` when present, else the play's
//     (task tags REPLACE play tags — no union);
//   - `--tags` runs only tasks carrying a listed tag (untagged tasks are excluded);
//   - `--skip-tags` excludes tasks carrying a listed tag and wins over `--tags`;
//   - handlers are exempt from the `--tags` inclusion filter and are excluded by
//     `--skip-tags` only when they explicitly declare a skipped tag;
//   - filtering happens on the fully-expanded task list (roles + include_tasks);
//   - with no flags, behavior is unchanged.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadPlaybook, loadPlaybookFile } from "../src/config/loader";
import { FsProjectSource } from "../src/vfs/fs-project-source";
import type { NormalizedInventory, NormalizedPlaybook } from "../src/config/schema";
import { registerModule, runPlaybook } from "../src/executor";
import {
  effectiveTaskTags,
  handlerExcludedBySkipTags,
  taskPassesTagFilter,
} from "../src/executor/tags";
import { parseTagList } from "../src/cli/parse-tags";
import { CliError } from "../src/cli/types";

function inventory(hosts: string[]): NormalizedInventory {
  return { groups: { all: { hosts, vars: {} } } };
}

function recordingModule(
  outcome: { changed?: boolean } = {},
): { name: string; events: string[] } {
  const events: string[] = [];
  const name = `__tags_rec_${Math.random().toString(36).slice(2)}`;
  registerModule({
    name,
    run: async (ctx) => {
      events.push(String(ctx.args["label"] ?? ""));
      return { changed: outcome.changed ?? false };
    },
  });
  return { name, events };
}

// --- schema ----------------------------------------------------------------

test("loadPlaybook accepts play- and task-level tags", () => {
  const pb = loadPlaybook(`
- hosts: all
  tags:
    - web
  tasks:
    - name: inherits
      module: debug
      args: {}
    - name: overrides
      module: debug
      args: {}
      tags:
        - db
`);
  const play = pb[0]!;
  expect(play.tags).toEqual(["web"]);
  expect(play.tasks[0]!.tags).toBeUndefined();
  expect(play.tasks[1]!.tags).toEqual(["db"]);
});

test("a collapsed task carrying tags canonicalizes (tags are structural, not a module key)", () => {
  const pb = loadPlaybook(`
- hosts: all
  tasks:
    - name: t
      debug:
        msg: hi
      tags:
        - web
`);
  const t = pb[0]!.tasks[0]!;
  expect(t.module).toBe("debug");
  expect(t.tags).toEqual(["web"]);
});

// --- pure helpers ----------------------------------------------------------

test("effectiveTaskTags: own tags replace play tags; undefined inherits", () => {
  expect(effectiveTaskTags(undefined, ["web"])).toEqual(["web"]);
  expect(effectiveTaskTags(["db"], ["web"])).toEqual(["db"]);
  expect(effectiveTaskTags(undefined, undefined)).toEqual([]);
});

test("taskPassesTagFilter: empty selection passes; inclusion requires a match; skip wins", () => {
  expect(taskPassesTagFilter([], {})).toBe(true);
  expect(taskPassesTagFilter([], { tags: ["web"] })).toBe(false);
  expect(taskPassesTagFilter(["web"], { tags: ["web"] })).toBe(true);
  expect(taskPassesTagFilter(["web"], { skipTags: ["web"] })).toBe(false);
  expect(taskPassesTagFilter(["web"], { tags: ["web"], skipTags: ["web"] })).toBe(false);
});

test("handlerExcludedBySkipTags: only explicit handler tags can exclude a handler", () => {
  expect(handlerExcludedBySkipTags(undefined, ["web"])).toBe(false);
  expect(handlerExcludedBySkipTags([], ["web"])).toBe(false);
  expect(handlerExcludedBySkipTags(["web"], ["web"])).toBe(true);
  expect(handlerExcludedBySkipTags(["db"], ["web"])).toBe(false);
  expect(handlerExcludedBySkipTags(["web"], undefined)).toBe(false);
});

// --- filtering against a resolved play --------------------------------------

test("--tags runs only tasks carrying a listed tag; untagged tasks are skipped", async () => {
  const m = recordingModule();
  const pb: NormalizedPlaybook = {
    hosts: ["all"],
    tasks: [
      { name: "tagged", module: m.name, args: { label: "tagged" }, notify: [], tags: ["web"] },
      { name: "untagged", module: m.name, args: { label: "untagged" }, notify: [] },
    ],
    vars: {},
  };
  const res = await runPlaybook([pb], inventory(["h1"]), { tags: ["web"] });
  expect(m.events).toEqual(["tagged"]);
  const outcomes = res.hosts["h1"]!;
  expect(outcomes.map((o) => o.task)).toEqual(["tagged", "untagged"]);
  expect(outcomes[0]!.skipped).toBe(false);
  expect(outcomes[1]!.skipped).toBe(true);
  expect(outcomes[1]!.msg).toContain("tag-filtered");
  expect(res.skipped).toBe(1);
  expect(res.ok).toBe(1);
});

test("--skip-tags excludes tasks carrying a listed tag", async () => {
  const m = recordingModule();
  const pb: NormalizedPlaybook = {
    hosts: ["all"],
    tasks: [
      { name: "tagged", module: m.name, args: { label: "tagged" }, notify: [], tags: ["web"] },
      { name: "untagged", module: m.name, args: { label: "untagged" }, notify: [] },
    ],
    vars: {},
  };
  const res = await runPlaybook([pb], inventory(["h1"]), { skipTags: ["web"] });
  expect(m.events).toEqual(["untagged"]);
  expect(res.hosts["h1"]![0]!.skipped).toBe(true);
  expect(res.hosts["h1"]![1]!.skipped).toBe(false);
});

test("play tags apply to untagged tasks; a task's own tags replace them (no union)", async () => {
  const m = recordingModule();
  const pb: NormalizedPlaybook = {
    hosts: ["all"],
    tags: ["web"],
    tasks: [
      { name: "inherits", module: m.name, args: { label: "inherits" }, notify: [] },
      { name: "overrides", module: m.name, args: { label: "overrides" }, notify: [], tags: ["db"] },
    ],
    vars: {},
  };
  const res = await runPlaybook([pb], inventory(["h1"]), { tags: ["web"] });
  expect(m.events).toEqual(["inherits"]);
  const overrides = res.hosts["h1"]!.find((o) => o.task === "overrides")!;
  expect(overrides.skipped).toBe(true);
});

test("--skip-tags wins over --tags on conflict", async () => {
  const m = recordingModule();
  const pb: NormalizedPlaybook = {
    hosts: ["all"],
    tasks: [
      { name: "both", module: m.name, args: { label: "both" }, notify: [], tags: ["web", "db"] },
      { name: "web-only", module: m.name, args: { label: "web-only" }, notify: [], tags: ["web"] },
    ],
    vars: {},
  };
  const res = await runPlaybook([pb], inventory(["h1"]), { tags: ["web"], skipTags: ["db"] });
  expect(m.events).toEqual(["web-only"]);
});

test("with no tag flags every task runs (default behavior unchanged)", async () => {
  const m = recordingModule();
  const pb: NormalizedPlaybook = {
    hosts: ["all"],
    tags: ["web"],
    tasks: [
      { name: "tagged", module: m.name, args: { label: "tagged" }, notify: [], tags: ["web"] },
      { name: "untagged", module: m.name, args: { label: "untagged" }, notify: [] },
    ],
    vars: {},
  };
  const res = await runPlaybook([pb], inventory(["h1"]));
  expect(m.events).toEqual(["tagged", "untagged"]);
  expect(res.skipped).toBe(0);
});

// --- handlers --------------------------------------------------------------

test("a notified handler still flushes under --tags (handlers exempt from inclusion)", async () => {
  const m = recordingModule({ changed: true });
  const pb = loadPlaybook(`
- hosts: all
  tasks:
    - name: change
      module: ${m.name}
      args:
        label: task
      tags:
        - web
      notify: restart nginx
  handlers:
    - name: restart nginx
      module: ${m.name}
      args:
        label: restart
`);
  const res = await runPlaybook(pb, inventory(["h1"]), { tags: ["web"] });
  expect(m.events).toEqual(["task", "restart"]);
  expect(res.handlers.map((h) => h.handler)).toEqual(["restart nginx"]);
});

test("a handler explicitly tagged with a skipped tag does not flush", async () => {
  const m = recordingModule({ changed: true });
  const pb = loadPlaybook(`
- hosts: all
  tasks:
    - name: change
      module: ${m.name}
      args:
        label: task
      notify: restart nginx
  handlers:
    - name: restart nginx
      module: ${m.name}
      args:
        label: restart
      tags:
        - slow
`);
  const res = await runPlaybook(pb, inventory(["h1"]), { skipTags: ["slow"] });
  expect(m.events).toEqual(["task"]);
  expect(res.handlers).toEqual([]);
});

test("a handler that only inherits a skipped play tag is not excluded", async () => {
  const m = recordingModule({ changed: true });
  const pb = loadPlaybook(`
- hosts: all
  tags:
    - web
  tasks:
    - name: change
      module: ${m.name}
      args:
        label: task
      tags:
        - db
      notify: restart nginx
  handlers:
    - name: restart nginx
      module: ${m.name}
      args:
        label: restart
`);
  const res = await runPlaybook(pb, inventory(["h1"]), { skipTags: ["web"] });
  expect(m.events).toEqual(["task", "restart"]);
  expect(res.handlers.map((h) => h.handler)).toEqual(["restart nginx"]);
});

// --- expansion (roles + include_tasks) --------------------------------------

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "rolecall-tags-"));
  const roleDir = join(dir, "roles", "r");
  mkdirSync(join(roleDir, "tasks"), { recursive: true });
  writeFileSync(
    join(roleDir, "tasks", "main.yml"),
    `- name: role task
  module: debug
  args:
    msg: role
  tags:
    - role
`,
  );
  writeFileSync(
    join(dir, "inc.yml"),
    `- hosts: all
  tasks:
    - name: included task
      module: debug
      args:
        msg: inc
      tags:
        - inc
`,
  );
  writeFileSync(
    join(dir, "site.yml"),
    `- hosts: all
  roles:
    - r
  tasks:
    - name: include directive
      include_tasks: inc.yml
    - name: plain
      module: debug
      args:
        msg: plain
      tags:
        - plain
`,
  );
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("tag filtering applies to role- and include_tasks-expanded tasks", async () => {
  const pb = await loadPlaybookFile(join(dir, "site.yml"), new FsProjectSource(dir));
  const play = pb[0]!;
  const tagsByName = new Map(play.tasks.map((t) => [t.name, t.tags]));
  expect(tagsByName.get("role task")).toEqual(["role"]);
  expect(tagsByName.get("included task")).toEqual(["inc"]);
  expect(tagsByName.get("plain")).toEqual(["plain"]);

  const res = await runPlaybook(pb, inventory(["h1"]), { tags: ["inc"] });
  const byName = new Map(res.hosts["h1"]!.map((o) => [o.task, o]));
  expect(byName.get("included task")!.skipped).toBe(false);
  expect(byName.get("role task")!.skipped).toBe(true);
  expect(byName.get("plain")!.skipped).toBe(true);
});

// --- CLI tag-list parsing ---------------------------------------------------

test("parseTagList splits on commas and trims whitespace", () => {
  expect(parseTagList(" web , db ", "--tags")).toEqual(["web", "db"]);
  expect(parseTagList("web", "--tags")).toEqual(["web"]);
  expect(parseTagList(undefined, "--tags")).toEqual([]);
});

test("parseTagList rejects an empty/whitespace-only list as a usage error", () => {
  for (const raw of ["", "   ", ",", " , "]) {
    let err: unknown;
    try {
      parseTagList(raw, "--skip-tags");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).usage).toBe(true);
    expect((err as CliError).message).toContain("--skip-tags");
  }
});
