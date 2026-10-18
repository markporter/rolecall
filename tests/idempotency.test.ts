// Idempotency layer tests (Todo 13). Bun-only MVP (bun test).
//
// Uses in-process fixture modules + an in-memory bun:sqlite cache (no docker/lxc).
// Covers: (a) first apply writes, (b) second identical apply skips (zero writes),
// (c) --force re-applies, (d) side-effecting module always applies, (e) hash
// determinism across key order.

import { expect, test } from "bun:test";
import type { ModuleContext } from "../src/executor/module";
import {
  applyIdempotent,
  computeCacheKey,
  sha256Hex,
  SqliteIdempotencyCache,
  type CheckableModule,
} from "../src/idempotency";

/** Fixture declarative module: writes `content` to `path` in an in-memory store. */
function declarativeFixture() {
  const store = new Map<string, string>();
  const writes = { count: 0 };
  const module: CheckableModule = {
    name: "fixture_write",
    async check(args: Record<string, unknown>) {
      const path = String(args.path);
      const content = String(args.content);
      const current = store.get(path);
      return { current, inDesired: current === content };
    },
    async run(c: ModuleContext) {
      const a = c.args as Record<string, unknown>;
      store.set(String(a.path), String(a.content));
      writes.count++;
      return { changed: true };
    },
  };
  return { module, store, writes };
}

/** Fixture side-effecting module: always mutates, no check path. */
function sideEffectingFixture() {
  const runs = { count: 0 };
  const module = {
    name: "fixture_shell",
    sideEffecting: true as const,
    async run(_args: Record<string, unknown>) {
      runs.count++;
      return { changed: true };
    },
  };
  return { module, runs };
}

function ctx(host = "h1"): ModuleContext {
  return {
    host,
    connection: {
      kind: "local",
      connect: async () => {},
      exec: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      facts: async () => ({ host, user: "nobody", transport: "local" }),
      disconnect: async () => {},
      health: async () => ({ ok: true }),
    },
    args: {},
    vars: {},
    facts: {},
    registered: {},
  };
}

// (a) first apply of a declarative module writes and reports changed.
test("(a) first apply writes and reports changed", async () => {
  const { module, writes } = declarativeFixture();
  const cache = new SqliteIdempotencyCache(":memory:");
  const res = await applyIdempotent(
    module,
    { path: "/etc/x", content: "v1" },
    ctx(),
    { cache },
  );
  expect(res.changed).toBe(true);
  expect(writes.count).toBe(1);
  cache.close();
});

// (b) second identical apply: check reports inDesired -> zero new writes.
test("(b) second identical apply skips with zero writes", async () => {
  const { module, writes } = declarativeFixture();
  const cache = new SqliteIdempotencyCache(":memory:");
  const args = { path: "/etc/x", content: "v1" };
  await applyIdempotent(module, args, ctx(), { cache });
  const res = await applyIdempotent(module, args, ctx(), { cache });
  expect(res.changed).toBe(false);
  expect(res.skippedUnchanged).toBe(true);
  expect(writes.count).toBe(1); // no additional write command issued
  cache.close();
});

// (c) --force re-applies even when already in desired state.
test("(c) --force re-applies regardless of state", async () => {
  const { module, writes } = declarativeFixture();
  const cache = new SqliteIdempotencyCache(":memory:");
  const args = { path: "/etc/x", content: "v1" };
  await applyIdempotent(module, args, ctx(), { cache });
  const res = await applyIdempotent(module, args, ctx(), { cache, force: true });
  expect(res.changed).toBe(true);
  expect(writes.count).toBe(2);
  cache.close();
});

// (d) side-effecting module applies every run, even with cache + rolecall_managed_only.
test("(d) side-effecting module always applies", async () => {
  const { module, runs } = sideEffectingFixture();
  const cache = new SqliteIdempotencyCache(":memory:");
  const args = { cmd: "echo hi" };
  const opts = { cache, rolecallManagedOnly: true };
  await applyIdempotent(module, args, ctx(), opts);
  await applyIdempotent(module, args, ctx(), opts);
  await applyIdempotent(module, args, ctx(), opts);
  expect(runs.count).toBe(3); // inherent side-effecting always applies
  cache.close();
});

// (e) hash-based cache key is deterministic across argument key order.
test("(e) cache key deterministic across key order", async () => {
  const a = await computeCacheKey("h", "m", { b: 1, a: 2 });
  const b = await computeCacheKey("h", "m", { a: 2, b: 1 });
  expect(a).toBe(b);
  // and sha256Hex is stable for identical input
  expect(await sha256Hex("rolecall")).toBe(await sha256Hex("rolecall"));
});
