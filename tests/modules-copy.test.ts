// Built-in module: `copy` — literal idempotent file copy.
//
// Exercises the imperative run() path through applyIdempotent. Copy ships its
// bytes base64-encoded and decodes them on-target inside one compare+write script
// (reusing the config-write harness), deciding changed by SHA-256 comparison. With
// no check() exposed, applyIdempotent routes straight through run(), whose own NOOP
// detection reports skippedUnchanged. Local-only (real localhost transport); no docker.

import { expect, test } from "bun:test";
import type { IdempotencyCache } from "../src/idempotency/types";
import { applyIdempotent } from "../src/idempotency";
import type { ModuleContext } from "../src/executor/module";
import { createConnection } from "../src/transport";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { copyModule } from "../src/modules/builtins/copy";

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

const tmp = (suffix: string) => join(tmpdir(), `rolecall-copy-${randomUUID()}${suffix}`);

test("copy writes src -> dest then is idempotent (skippedUnchanged)", async () => {
  const src = tmp(".conf");
  writeFileSync(src, "line1\nline2\nport=8080\n");
  const dest = tmp(".conf");

  const first = await applyIdempotent(copyModule, { src, dest }, localCtx({ src, dest }), { cache: cache() });
  expect(first.changed).toBe(true);
  expect(first.failed).toBeFalsy();
  expect(Buffer.from(readFileSync(dest))).toEqual(Buffer.from(readFileSync(src)));

  const second = await applyIdempotent(copyModule, { src, dest }, localCtx({ src, dest }), { cache: cache() });
  expect(second.changed).toBe(false);
  expect(second.skipped).toBe(true);
  expect(second.skippedUnchanged).toBe(true);
});

test("copy supports inline content:", async () => {
  const dest = tmp(".txt");
  const content = 'inline=1\nname="rolecall"\n';

  const first = await applyIdempotent(copyModule, { content, dest }, localCtx({ content, dest }), { cache: cache() });
  expect(first.changed).toBe(true);
  expect(await Bun.file(dest).text()).toBe(content);

  const second = await applyIdempotent(copyModule, { content, dest }, localCtx({ content, dest }), { cache: cache() });
  expect(second.skippedUnchanged).toBe(true);
});

test("copy re-copies when the destination diverges", async () => {
  const src = tmp(".conf");
  writeFileSync(src, "v1");
  const dest = tmp(".conf");

  await applyIdempotent(copyModule, { src, dest }, localCtx({ src, dest }), { cache: cache() });
  expect(existsSync(dest)).toBe(true);

  writeFileSync(dest, "corrupted");

  const again = await applyIdempotent(copyModule, { src, dest }, localCtx({ src, dest }), { cache: cache() });
  expect(again.changed).toBe(true);
  expect(readFileSync(dest, "utf8")).toBe("v1");

  const settled = await applyIdempotent(copyModule, { src, dest }, localCtx({ src, dest }), { cache: cache() });
  expect(settled.skippedUnchanged).toBe(true);
});

test("copy validates required args", async () => {
  const noDest = await copyModule.run(localCtx({ src: tmp(".x"), content: "hi" }));
  expect(noDest.failed).toBe(true);
  expect(noDest.changed).toBe(false);
  expect(String(noDest.msg ?? "")).toContain("'dest'");

  const noContent = await copyModule.run(localCtx({ dest: tmp(".y") }));
  expect(noContent.failed).toBe(true);
  expect(String(noContent.msg ?? "")).toContain("content");
});

test("copy --check reports wouldChange without writing", async () => {
  const src = tmp(".conf");
  writeFileSync(src, "v1");
  const dest = tmp(".conf");

  const res = await applyIdempotent(copyModule, { src, dest, _check: true }, localCtx({ src, dest, _check: true }), {
    cache: cache(),
  });
  expect(res.changed).toBe(false);
  expect(res.skipped).toBe(true);
  expect(res.data?.["wouldChange"]).toBe(true);
  expect(existsSync(dest)).toBe(false);
});

test("copy backs up an existing destination before overwriting", async () => {
  const src = tmp(".conf");
  writeFileSync(src, "NEW");
  const dest = tmp(".conf");
  writeFileSync(dest, "OLD");

  const r = await applyIdempotent(copyModule, { src, dest, backup: true }, localCtx({ src, dest, backup: true }), {
    cache: cache(),
  });
  expect(r.changed).toBe(true);
  const backupFile = r.data?.["backup_file"];
  expect(typeof backupFile).toBe("string");
  expect((backupFile as string).endsWith(".bak")).toBe(true);
  expect(readFileSync(backupFile as string, "utf8")).toBe("OLD");
  expect(readFileSync(dest, "utf8")).toBe("NEW");
});
