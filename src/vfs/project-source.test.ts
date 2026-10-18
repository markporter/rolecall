/**
 * FsProjectSource contract tests for the VFS seam (Task 2 of vfs-db-abstractions).
 *
 * Covers the {@link ProjectSource} surface on the real disk-backed implementation:
 * reads, existence, recursive listing with glob filtering, and absolute-path
 * resolution used to reach user modules (`module: ./path`). Runtime-agnostic — uses
 * only Node builtins so it stays green under both `ROLECALL_RUNTIME=bun` and `node`.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { FsProjectSource } from "./fs-project-source.js";

describe("FsProjectSource", () => {
  let root: string;

  beforeEach(() => {
    // Unique fixtures dir per test so runs never collide.
    root = mkdtempSync(join(tmpdir(), "rolecall-vfs-ps-"));
    writeFileSync(join(root, "playbook.yaml"), "hosts: all\n");
    mkdirSync(join(root, "roles"));
    writeFileSync(join(root, "roles", "web.yaml"), "# web role vars\n");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("exposes an absolute root defaulting to cwd when none is passed", () => {
    const fromCwd = new FsProjectSource();
    expect(isAbsolute(fromCwd.root)).toBe(true);

    const explicit = new FsProjectSource(root);
    expect(explicit.root).toBe(root);
  });

  it("readText returns file contents as UTF-8 text", async () => {
    const src = new FsProjectSource(root);
    expect(await src.readText("playbook.yaml")).toBe("hosts: all\n");
  });

  it("exists is true for present entries and false for missing ones", async () => {
    const src = new FsProjectSource(root);
    expect(await src.exists("playbook.yaml")).toBe(true);
    expect(await src.exists("roles/web.yaml")).toBe(true);
    expect(await src.exists("missing.yaml")).toBe(false);
  });

  it("listFiles lists every file recursively as sorted posix paths", async () => {
    const src = new FsProjectSource(root);
    expect(await src.listFiles()).toEqual(["playbook.yaml", "roles/web.yaml"]);
  });

  it("listFiles filters by glob, matching basename across directories", async () => {
    const src = new FsProjectSource(root);
    expect((await src.listFiles("*.yaml")).sort()).toEqual([
      "playbook.yaml",
      "roles/web.yaml",
    ]);
    expect(await src.listFiles("roles/*.yaml")).toEqual(["roles/web.yaml"]);
  });

  it("readText of a missing path rejects with ENOENT", async () => {
    const src = new FsProjectSource(root);
    try {
      await src.readText("does-not-exist.yaml");
      throw new Error("expected readText to reject");
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      expect(err.code).toBe("ENOENT");
    }
  });

  it("resolveImportablePath turns './mod.ts' into an absolute path under the root", () => {
    const src = new FsProjectSource(root);
    const abs = src.resolveImportablePath("./mod.ts");
    expect(isAbsolute(abs)).toBe(true);
    expect(abs.startsWith(root + "/")).toBe(true);
    expect(abs).toBe(join(root, "mod.ts"));
  });
});
