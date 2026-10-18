/**
 * ScratchVfs — a minimal key/value scratch space for temporary artifacts.
 *
 * Implementations are selected by `ROLECALL_SCRATCH` (fs|memory, default fs) via
 * `createScratchStore()` in this module. The default `FsScratchStore` writes
 * under a unique subdirectory of `ROLECALL_SCRATCH_DIR` (or `os.tmpdir()`) so
 * concurrent stores never collide. `MemoryScratchStore` keeps everything in a
 * `Map<string, string>` for fast in-process tests.
 *
 * All methods are async for a uniform surface; the memory impl resolves
 * immediately. `read`/`delete` of a missing name reject with `ENOENT`-style
 * errors; `exists` returns `false`; `list` returns only names written by this
 * store instance.
 */
export interface ScratchVfs {
  /** Write `data` under logical `name`. Overwrites if `name` already exists. */
  write(name: string, data: string): Promise<void>;
  /** Read the string stored at `name`. Rejects if `name` does not exist. */
  read(name: string): Promise<string>;
  /** Return true iff `name` exists in this store. */
  exists(name: string): Promise<boolean>;
  /** Delete `name`. No-op if `name` does not exist. */
  delete(name: string): Promise<void>;
  /** Return all logical names currently stored (order not guaranteed). */
  list(): Promise<string[]>;
}

/**
 * Factory that returns a `ScratchVfs` implementation based on `loadConfig().scratch`.
 * Default is `"fs"` (disk-backed via `FsScratchStore`). Set `ROLECALL_SCRATCH=memory`
 * to use the in-memory `MemoryScratchStore`.
 */
export async function createScratchStore(): Promise<ScratchVfs> {
  const { loadConfig } = await import("../config/env.js");
  const cfg = loadConfig();
  if (cfg.scratch === "memory") {
    const { MemoryScratchStore } = await import("./memory-scratch-store.js");
    return new MemoryScratchStore();
  }
  const { FsScratchStore } = await import("./fs-scratch-store.js");
  return new FsScratchStore(cfg.scratchDir);
}