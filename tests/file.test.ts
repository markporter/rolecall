// Hermetic tests for the `file` built-in (P8).
//
// Uses a REAL LocalConn whose `exec` actually runs commands via `sh -c` on the
// host machine, backed by a scratch temp dir created with mkdtempSync. No network,
// no fakes of the shell itself. The context is bridged via `as unknown as
// ModuleContext`; the connection structurally satisfies the full Connection
// contract (all six members) without any casting.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, readlinkSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Connection, ExecResult } from "../src/transport/connection";
import type { ModuleContext } from "../src/executor/module";
import { fileModule } from "../src/modules/builtins/file";

/** Runs every command through the real `/bin/sh` and reports genuine results. */
class LocalConn implements Connection {
  readonly kind = "local";
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async facts(): Promise<{ host: string; user: string; transport: "local" }> {
    return { host: "h1", user: process.env.USER ?? "x", transport: "local" };
  }
  async health(): Promise<{ ok: boolean }> {
    return { ok: true };
  }
  async exec(command: string): Promise<ExecResult> {
    const res = Bun.spawnSync(["sh", "-c", command]);
    const dec = new TextDecoder();
    return {
      exitCode: typeof res.exitCode === "number" ? res.exitCode : null,
      stdout: dec.decode((res.stdout ?? new Uint8Array()) as Uint8Array),
      stderr: dec.decode((res.stderr ?? new Uint8Array()) as Uint8Array),
    };
  }
}

let workdir: string;
const conn = new LocalConn();

function ctx(args: Record<string, unknown>): ModuleContext {
  return {
    host: "h1",
    connection: conn,
    args,
    vars: {},
    facts: {},
    registered: {},
    become: false,
  } as unknown as ModuleContext;
}

async function run(args: Record<string, unknown>) {
  return fileModule.run(ctx(args));
}

beforeAll(() => {
  workdir = mkdtempSync(join(tmpdir(), "rolecall-file-test-"));
});

afterAll(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("file module", () => {
  test("directory is created once and idempotent on re-run", async () => {
    const p = join(workdir, "srv");
    const first = await run({ path: p, state: "directory" });
    expect(first.changed).toBe(true);
    expect(existsSync(p)).toBe(true);
    expect(statSync(p).isDirectory()).toBe(true);

    const second = await run({ path: p, state: "directory" });
    expect(second.changed).toBe(false);
    expect(second.data?.state).toBe("directory");
  });

  test("absent removes a created regular file then stays unchanged", async () => {
    const p = join(workdir, "drop.txt");
    writeFileSync(p, "hi");
    expect(existsSync(p)).toBe(true);

    const removed = await run({ path: p, state: "absent" });
    expect(removed.changed).toBe(true);
    expect(existsSync(p)).toBe(false);

    const again = await run({ path: p, state: "absent" });
    expect(again.changed).toBe(false);
  });

  test("touch creates when missing and does not churn an existing entry", async () => {
    const p = join(workdir, "touched");
    const first = await run({ path: p, state: "touch" });
    expect(first.changed).toBe(true);
    expect(existsSync(p)).toBe(true);

    const second = await run({ path: p, state: "touch" });
    expect(second.changed).toBe(false);
  });

  test("creates an empty regular file under a fresh parent directory", async () => {
    const p = join(workdir, "nested", "deep", "f.conf");
    const res = await run({ path: p, state: "file" });
    expect(res.changed).toBe(true);
    expect(existsSync(p)).toBe(true);
    expect(readIfExists(p)).toBe("");
    // Re-run must be a no-op now that the file exists.
    const again = await run({ path: p, state: "file" });
    expect(again.changed).toBe(false);
  });

  test("link creates a symlink pointing at src and is idempotent", async () => {
    const target = join(workdir, "target.bin");
    writeFileSync(target, "payload");
    const link = join(workdir, "alias.bin");
    if (existsSync(link)) rmSync(link);

    const created = await run({ path: link, state: "link", src: target });
    expect(created.changed).toBe(true);
    expect(existsSync(link)).toBe(true);
    expect(readlinkSync(link)).toBe(target);

    const stable = await run({ path: link, state: "link", src: target });
    expect(stable.changed).toBe(false);
    expect(readlinkSync(link)).toBe(target);
  });

  test("applies mode to a directory and then stays idempotent", async () => {
    const p = join(workdir, "mode-dir");
    await run({ path: p, state: "directory" });

    const applied = await run({ path: p, state: "directory", mode: "0755" });
    expect(applied.changed).toBe(true);
    expect(statSync(p).mode & 0o777).toBe(0o755);

    const stable = await run({ path: p, state: "directory", mode: "0755" });
    expect(stable.changed).toBe(false);
  });

  test("rejects a missing 'path'", async () => {
    const res = await run({ state: "directory" });
    expect(res.failed).toBe(true);
    expect(res.msg).toContain("'path' is required");
  });

  test("requires 'src' for link state", async () => {
    const res = await run({ path: join(workdir, "x"), state: "link" });
    expect(res.failed).toBe(true);
    expect(res.msg).toContain("'src' is required");
  });

  test("reports invalid state values", async () => {
    const res = await run({ path: join(workdir, "y"), state: "bogus" as unknown as string });
    expect(res.failed).toBe(true);
    expect(res.msg).toContain("must be one of");
  });
});

function readIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}
