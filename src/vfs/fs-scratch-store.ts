/**
 * FsScratchStore — disk-backed ScratchVfs implementation.
 *
 * Each instance creates a unique subdirectory under the provided `baseDir`
 * (default: `loadConfig().scratchDir` which resolves to `ROLECALL_SCRATCH_DIR` or
 * `os.tmpdir()`). This ensures concurrent stores never collide. The subdirectory
 * is created via `mkdtempSync(join(baseDir, "rolecall-scratch-"))` on construction.
 *
 * All operations are async for interface uniformity. `read`/`delete` of a
 * missing name reject with an error whose `code` is `"ENOENT"`. `exists`
 * returns `false` for missing names. `list` returns only the logical names
 * (filenames) written by this store instance.
 */
import { writeFile, readFile, unlink, readdir, stat } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import type { ScratchVfs } from "./scratch.js";

export class FsScratchStore implements ScratchVfs {
  #dir: string;

  /**
   * Create a new FsScratchStore.
   * @param baseDir - Parent directory for the unique scratch subdir. Defaults to
   *   `loadConfig().scratchDir` (which falls back to `os.tmpdir()`).
   */
  constructor(baseDir?: string) {
    const base = baseDir ?? (() => {
      // Lazy-load to avoid circular import at module evaluation time
      const { loadConfig } = require("../config/env.js");
      return loadConfig().scratchDir;
    })();
    this.#dir = mkdtempSync(join(base, "rolecall-scratch-"));
  }

  /** @internal Exposed for tests that need to inspect the backing directory. */
  get directory(): string {
    return this.#dir;
  }

  async write(name: string, data: string): Promise<void> {
    await writeFile(this.#path(name), data, "utf-8");
  }

  async read(name: string): Promise<string> {
    try {
      return await readFile(this.#path(name), "utf-8");
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        const error = new Error(`Scratch entry not found: ${name}`);
        error.name = "NotFoundError";
        (error as NodeJS.ErrnoException).code = "ENOENT";
        throw error;
      }
      throw e;
    }
  }

  async exists(name: string): Promise<boolean> {
    try {
      await stat(this.#path(name));
      return true;
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") return false;
      throw e;
    }
  }

  async delete(name: string): Promise<void> {
    try {
      await unlink(this.#path(name));
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") throw e;
      // No-op if missing (per contract)
    }
  }

  async list(): Promise<string[]> {
    try {
      const entries = await readdir(this.#dir);
      // Filter out any non-regular files (e.g. stray directories)
      const names: string[] = [];
      for (const entry of entries) {
        const full = join(this.#dir, entry);
        const st = await stat(full);
        if (st.isFile()) names.push(entry);
      }
      return names;
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") return [];
      throw e;
    }
  }

  #path(name: string): string {
    // Prevent path traversal — names are logical keys, not paths
    if (name.includes("/") || name.includes("\\") || name === ".." || name === ".") {
      throw new Error(`Invalid scratch name: ${name}`);
    }
    return join(this.#dir, name);
  }
}