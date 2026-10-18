// Read-only `stat` module (Todo 27): reports whether a target path exists plus its
// kind/attributes over a Local connection, always returning changed:false because it
// never mutates state. Covers registration, applyIdempotent through the cache path,
// missing-path handling, and required-arg validation.
// Bun-only MVP (bun test).

import { expect, test } from "bun:test";
import type { IdempotencyCache } from "../src/idempotency/types";
import { applyIdempotent } from "../src/idempotency";
import type { ModuleContext } from "../src/executor/module";
import { registerModule, getModule } from "../src/executor/module";
import { createNoopConnection } from "../src/executor/context";
import { createConnection } from "../src/transport";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { statModule } from "../src/modules/builtins/stat";

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

const tmp = (suffix: string) => join(tmpdir(), `rolecall-stat-${randomUUID()}${suffix}`);

// --- registration -----------------------------------------------------------
test("stat registers under its name via registerModule", () => {
  registerModule(statModule);
  expect(getModule("stat")).toBe(statModule);
});

// --- applyIdempotent on an existing path ------------------------------------
test("stat reports an existing file and stays unchanged (cache path)", async () => {
  const path = tmp(".dat");
  await createConnection({ kind: "local", host: "h1", user: "ci" })
    .exec(`printf '%s' 'hello world' > ${path}`);

  const args = { path };
  const first = await applyIdempotent(statModule, args, localCtx(args), { cache: cache() });
  expect(first.changed).toBe(false);
  expect(first.failed ?? false).toBe(false);
  expect(first.data?.["exists"]).toBe(true);
  expect(first.data?.["isfile"]).toBe(true);
  expect(first.data?.["isdir"]).toBe(false);

  // Second run goes through the same observe-and-reconcile policy but still
  // returns the real snapshot (read-only probe, not a mutating resource).
  const second = await applyIdempotent(statModule, args, localCtx(args), { cache: cache() });
  expect(second.changed).toBe(false);
  expect(second.data?.["exists"]).toBe(true);
});

// --- missing path -----------------------------------------------------------
test("stat reports a missing path as absent without throwing", async () => {
  const ghost = tmp(".ghost");
  const res = await applyIdempotent(statModule, { path: ghost }, localCtx({ path: ghost }), {
    cache: cache(),
  });
  expect(res.changed).toBe(false);
  expect(res.data?.["exists"]).toBe(false);
  expect(res.data?.["isfile"] ?? false).toBeFalsy();
  expect(res.data?.["isdir"] ?? false).toBeFalsy();
  expect(res.data?.["islnk"] ?? false).toBeFalsy();
});

// --- directory detection ----------------------------------------------------
test("stat distinguishes directories from regular files", async () => {
  const dir = tmp("-dir");
  await createConnection({ kind: "local", host: "h1", user: "ci" }).exec(`mkdir -p ${dir}`);
  const res = await statModule.run(localCtx({ path: dir }));
  expect(res.data?.["exists"]).toBe(true);
  expect(res.data?.["isdir"]).toBe(true);
  expect(res.data?.["isfile"]).toBe(false);
});

// --- required arg validation ------------------------------------------------
test("stat fails when path is omitted", async () => {
  const res = await statModule.run(noopCtx({}));
  expect(res.changed).toBe(false);
  expect(res.failed).toBe(true);
  expect(String(res.msg)).toContain("path");
});
