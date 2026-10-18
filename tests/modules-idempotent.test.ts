// Idempotency-by-default modules (Todo 27): covers the `resource()` helper, each
// batteries-included builtin module's idempotent check+converge via
// `applyIdempotent`, the config-loader lint guard, and `searchModules()`.
// Bun-only MVP (bun test).

import { afterAll, beforeAll, expect, test } from "bun:test";
import type { IdempotencyCache } from "../src/idempotency/types";
import { applyIdempotent } from "../src/idempotency";
import type { ModuleContext } from "../src/executor/module";
import { createNoopConnection } from "../src/executor/context";
import { createConnection } from "../src/transport";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { resource } from "../src/modules/resource";
import { searchModules } from "../src/modules/search";
import { registerAllModules } from "../src/modules/builtins";
import { httpModule } from "../src/modules/builtins/http";
import { configEditModule } from "../src/modules/builtins/config_edit";
import { blockinfileModule } from "../src/modules/builtins/blockinfile";
import { lineinfileModule } from "../src/modules/builtins/lineinfile";
import { sqlModule } from "../src/modules/builtins/sql";
import { shellModule } from "../src/modules/builtins/shell";
import { lintPlaybookIdempotency, loadPlaybook } from "../src/config/loader";

// --- in-memory idempotency cache --------------------------------------------
class MemoryCache implements IdempotencyCache {
  #m = new Map<string, { observed: unknown; appliedAt: number }>();
  async get(k: string) {
    return this.#m.get(k);
  }
  async set(k: string, e: { observed: unknown; appliedAt: number }) {
    this.#m.set(k, e);
  }
  async has(k: string) {
    return this.#m.has(k);
  }
  close() {}
}

function cache(): IdempotencyCache {
  return new MemoryCache();
}

// --- context helpers --------------------------------------------------------
function noopCtx(args: Record<string, unknown>): ModuleContext {
  return {
    host: "h1",
    connection: createNoopConnection("h1"),
    args,
    vars: {},
    facts: {},
    registered: {},
  } as ModuleContext;
}

function localCtx(args: Record<string, unknown>): ModuleContext {
  return {
    host: "h1",
    connection: createConnection({ kind: "local", host: "h1", user: "ci" }),
    args,
    vars: {},
    facts: {},
    registered: {},
  } as ModuleContext;
}

const tmp = (suffix: string) => join(tmpdir(), `rolecall-idem-${randomUUID()}${suffix}`);

// --- resource() -------------------------------------------------------------
test("resource() returns a Module & CheckableModule (run + check)", async () => {
  let converged = false;
  const r = resource({
    describe: () => ({ current: 0, inDesired: true }),
    converge: () => {
      converged = true;
      return { changed: true, msg: "did" };
    },
  });
  expect(typeof r.run).toBe("function");
  expect(typeof r.check).toBe("function");
  const d = await r.check!({}, noopCtx({}));
  expect(d.inDesired).toBe(true);
  // `run` is self-idempotent (skips when describe reports inDesired), so use
  // `force` to exercise the converge path explicitly.
  const res = await r.run(noopCtx({ force: true }));
  expect(res.changed).toBe(true);
  expect(converged).toBe(true);
});

test("resource() converge maps to run and describe to check", async () => {
  const r = resource({
    name: "demo",
    describe: (args) => ({ current: args["v"], inDesired: args["v"] === "x" }),
    converge: () => ({ changed: true, msg: "applied" }),
  });
  expect(r.name).toBe("demo");
  const first = await applyIdempotent(r, { v: "y" }, noopCtx({ v: "y" }), { cache: cache() });
  expect(first.changed).toBe(true);
  const second = await applyIdempotent(r, { v: "x" }, noopCtx({ v: "x" }), { cache: cache() });
  expect(second.skipped).toBe(true);
  expect(second.skippedUnchanged).toBe(true);
});

// --- http / rest ------------------------------------------------------------
let server: ReturnType<typeof Bun.serve> | undefined;
let baseUrl = "";

beforeAll(() => {
  const created = new Set<string>();
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      if (req.method === "GET") {
        return new Response(created.has(path) ? "exists" : "missing", {
          status: created.has(path) ? 200 : 404,
        });
      }
      if (req.method === "PUT") {
        created.add(path);
        return new Response("ok", { status: 204 });
      }
      return new Response("not found", { status: 404 });
    },
  });
  baseUrl = `http://localhost:${(server as { port: number }).port}`;
});

afterAll(() => server?.stop(true));

test("http module is idempotent: PUT only applies once", async () => {
  const args = { url: `${baseUrl}/item`, method: "PUT" };
  const first = await applyIdempotent(httpModule, args, noopCtx(args), { cache: cache() });
  expect(first.changed).toBe(true);
  expect(first.failed).toBe(false);

  const second = await applyIdempotent(httpModule, args, noopCtx(args), { cache: cache() });
  expect(second.skipped).toBe(true);
  expect(second.skippedUnchanged).toBe(true);
});

test("http module check() observes current state for safe methods", async () => {
  const miss = { url: `${baseUrl}/missing`, method: "GET" };
  const d = await httpModule.check!(miss, noopCtx(miss));
  expect(d.inDesired).toBe(false); // 404, not the expected 200

  const put = { url: `${baseUrl}/thing`, method: "PUT" };
  const post = await httpModule.run(noopCtx(put));
  expect(post.changed).toBe(true);

  const get = { url: `${baseUrl}/thing`, method: "GET" };
  const ok = await httpModule.check!(get, noopCtx(get));
  expect(ok.inDesired).toBe(true); // now 200
});

// --- edit (json) ------------------------------------------------------------
test("edit module idempotently merges a json key", async () => {
  const path = tmp(".json");
  await createConnection({ kind: "local", host: "h1", user: "ci" })
    .exec(`printf '%s' '{"a":1}' > ${path}`);

  const args = { path, format: "json", key: "b", value: 2 };
  const first = await applyIdempotent(configEditModule, args, localCtx(args), { cache: cache() });
  expect(first.changed).toBe(true);

  const body = await Bun.file(path).text();
  expect(JSON.parse(body)).toEqual({ a: 1, b: 2 });

  const second = await applyIdempotent(configEditModule, args, localCtx(args), { cache: cache() });
  expect(second.skipped).toBe(true);
  expect(second.skippedUnchanged).toBe(true);
});

// --- blockinfile ------------------------------------------------------------
test("blockinfile module is idempotent", async () => {
  const path = tmp(".txt");
  const args = { path, block: "line one\nline two" };
  const first = await applyIdempotent(blockinfileModule, args, localCtx(args), { cache: cache() });
  expect(first.changed).toBe(true);
  const second = await applyIdempotent(blockinfileModule, args, localCtx(args), { cache: cache() });
  expect(second.skipped).toBe(true);
  expect(second.skippedUnchanged).toBe(true);

  // absent state removes it idempotently
  const rm = { path, block: "line one\nline two", state: "absent" };
  const r1 = await applyIdempotent(blockinfileModule, rm, localCtx(rm), { cache: cache() });
  expect(r1.changed).toBe(true);
  const r2 = await applyIdempotent(blockinfileModule, rm, localCtx(rm), { cache: cache() });
  expect(r2.skipped).toBe(true);
});

// --- lineinfile -------------------------------------------------------------
test("lineinfile module ensures a line once", async () => {
  const path = tmp(".cfg");
  const args = { path, line: "FOO=bar" };
  const first = await applyIdempotent(lineinfileModule, args, localCtx(args), { cache: cache() });
  expect(first.changed).toBe(true);
  const second = await applyIdempotent(lineinfileModule, args, localCtx(args), { cache: cache() });
  expect(second.skipped).toBe(true);
  const text = await Bun.file(path).text();
  expect(text.split("\n").filter((l) => l === "FOO=bar").length).toBe(1);
});

// --- sql --------------------------------------------------------------------
test("sql module applies a migration once", async () => {
  const db = tmp(".db");
  const args = {
    db,
    query: "CREATE TABLE t(id INTEGER)",
    check_query: "SELECT 1 FROM sqlite_master WHERE type='table' AND name='t'",
  };
  const first = await applyIdempotent(sqlModule, args, noopCtx(args), { cache: cache() });
  expect(first.changed).toBe(true);
  const second = await applyIdempotent(sqlModule, args, noopCtx(args), { cache: cache() });
  expect(second.skipped).toBe(true);
  expect(second.skippedUnchanged).toBe(true);
});

// --- shell (guarded + dry-run) -------------------------------------
test("shell module is guarded by creates and supports --dry-run", async () => {
  const path = tmp(".flag");
  const args = { command: `touch ${path}`, creates: path };
  const first = await applyIdempotent(shellModule, args, localCtx(args), { cache: cache() });
  expect(first.changed).toBe(true);
  const second = await applyIdempotent(shellModule, args, localCtx(args), { cache: cache() });
  expect(second.skipped).toBe(true);

  const dry = await shellModule.run(localCtx({ command: "echo hi", _check: true, run_mode: "always" }));
  expect(dry.changed).toBe(false);
  expect(dry.data?.["dryRun"]).toBe(true);
  expect(String(dry.msg)).toContain("would run");
});

// --- lint guard -------------------------------------------------------------
test("lint guard warns on unguarded shell/command tasks", () => {
  const pb = loadPlaybook(`
- name: demo
  hosts: all
  tasks:
    - name: safe-step
      module: debug
      args: {}
    - name: risky-shell
      module: shell
      args:
        cmd: rm -rf /tmp/x
    - name: guarded-shell
      module: shell
      args:
        cmd: do-thing
        creates: /tmp/done
`);
  const warns = lintPlaybookIdempotency(pb[0]!);
  const risky = warns.find((w) => w.task === "risky-shell");
  expect(risky).toBeDefined();
  expect(risky!.module).toBe("shell");
  expect(warns.find((w) => w.task === "guarded-shell")).toBeUndefined();
  expect(warns.find((w) => w.task === "safe-step")).toBeUndefined();
});

test("lint guard does not warn when no shell/command tasks present", () => {
  const pb = loadPlaybook(`
- hosts: all
  tasks:
    - name: only-edit
      module: config_edit
      args: { path: /x, format: json }
`);
  expect(lintPlaybookIdempotency(pb[0]!)).toEqual([]);
});

// --- shell guards + verify -----------------------------------------
test("shell creates_cmd guards re-runs (skip when satisfied)", async () => {
  const flag = tmp(".flag");
  const args = { command: `touch ${flag}`, creates_cmd: `test -e ${flag}` };
  const first = await applyIdempotent(shellModule, args, localCtx(args), { cache: cache() });
  expect(first.changed).toBe(true);
  const second = await applyIdempotent(shellModule, args, localCtx(args), { cache: cache() });
  expect(second.skipped).toBe(true);
  expect(second.skippedUnchanged).toBe(true);
});

test("shell verify_cmd marks failed on non-zero exit", async () => {
  const args = { command: "echo ok", verify_cmd: "false", run_mode: "always" };
  const res = await applyIdempotent(shellModule, args, localCtx(args), { cache: cache() });
  expect(res.changed).toBe(true);
  expect(res.failed).toBe(true);
});

test("shell throws when guarded (default) without an idempotency guard", async () => {
  const args = { command: "echo hi" };
  await expect(
    applyIdempotent(shellModule, args, localCtx(args), { cache: cache() }),
  ).rejects.toThrow(/no idempotency guard/);
});

test("shell does not throw when run_mode: always is set explicitly", async () => {
  const args = { command: "echo hi", run_mode: "always" };
  const res = await applyIdempotent(shellModule, args, localCtx(args), { cache: cache() });
  expect(res.changed).toBe(true);
  expect(res.failed).toBe(false);
});

// --- intentional lint acknowledgement ---------------------------------------
test("lint guard suppressed by run_mode: always on shell", () => {
  const pb = loadPlaybook(`
- name: demo
  hosts: all
  tasks:
    - name: deliberate-shell
      module: shell
      args:
        cmd: rm -rf /tmp/x
        run_mode: "always"
`);
  expect(lintPlaybookIdempotency(pb[0]!)).toEqual([]);
});

// --- searchModules ----------------------------------------------------------
test("searchModules filters by name/description", () => {
  registerAllModules();
  const edit = searchModules("edit");
  expect(edit.some((m) => m.name === "config_edit" && m.idempotent === true)).toBe(true);

  const desc = searchModules("idempotent HTTP");
  expect(desc.some((m) => m.name === "http")).toBe(true);

  const none = searchModules("zzz-no-such-module");
  expect(none).toEqual([]);

  const all = searchModules("");
  expect(all.length).toBeGreaterThan(0);
  expect(all.every((m) => typeof m.name === "string")).toBe(true);
});
