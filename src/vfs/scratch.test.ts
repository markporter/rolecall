/**
 * ScratchVfs contract tests — run against both FsScratchStore and MemoryScratchStore.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { FsScratchStore } from "./fs-scratch-store.js";
import { MemoryScratchStore } from "./memory-scratch-store.js";
import type { ScratchVfs } from "./scratch.js";

function runSuite(name: string, factory: () => ScratchVfs) {
  describe(name, () => {
    let store: ScratchVfs;

    beforeEach(() => {
      store = factory();
    });

    it("write then read returns the same data", async () => {
      await store.write("foo", "hello world");
      const data = await store.read("foo");
      expect(data).toBe("hello world");
    });

    it("write overwrites existing key", async () => {
      await store.write("key", "v1");
      await store.write("key", "v2");
      const data = await store.read("key");
      expect(data).toBe("v2");
    });

    it("exists returns true for written key", async () => {
      await store.write("exists-key", "data");
      const exists = await store.exists("exists-key");
      expect(exists).toBe(true);
    });

    it("exists returns false for missing key", async () => {
      const exists = await store.exists("missing-key");
      expect(exists).toBe(false);
    });

    it("delete removes the key", async () => {
      await store.write("to-delete", "data");
      await store.delete("to-delete");
      const exists = await store.exists("to-delete");
      expect(exists).toBe(false);
    });

    it("delete of missing key is a no-op (does not throw)", async () => {
      // Per contract: delete of missing name is a no-op
      await expect(store.delete("never-existed")).resolves.toBeUndefined();
    });

    it("read of missing key throws ENOENT", async () => {
      try {
        await store.read("missing");
        throw new Error("expected read to throw");
      } catch (e: unknown) {
        const err = e as NodeJS.ErrnoException;
        expect(err.code).toBe("ENOENT");
      }
    });

    it("list returns all written keys", async () => {
      await store.write("a", "1");
      await store.write("b", "2");
      await store.write("c", "3");
      const keys = await store.list();
      expect(keys.sort()).toEqual(["a", "b", "c"]);
    });

    it("list returns empty array for new store", async () => {
      const keys = await store.list();
      expect(keys).toEqual([]);
    });

    it("list only returns keys from this store instance", async () => {
      // This test ensures isolation — a second store doesn't see the first's keys
      await store.write("shared", "data");
      const keys1 = await store.list();
      expect(keys1).toContain("shared");

      const store2 = factory();
      const keys2 = await store2.list();
      expect(keys2).not.toContain("shared");
    });

    it("handles empty string values", async () => {
      await store.write("empty", "");
      const data = await store.read("empty");
      expect(data).toBe("");
    });

    it("handles unicode values", async () => {
      const unicode = "hello 世界 🌍";
      await store.write("unicode", unicode);
      const data = await store.read("unicode");
      expect(data).toBe(unicode);
    });

    it("handles large values", async () => {
      const large = "x".repeat(100_000);
      await store.write("large", large);
      const data = await store.read("large");
      expect(data).toBe(large);
    });
  });
}

runSuite("FsScratchStore", () => new FsScratchStore());
runSuite("MemoryScratchStore", () => new MemoryScratchStore());

// Additional FsScratchStore-specific tests
describe("FsScratchStore isolation", () => {
  it("creates unique subdirectory per instance", async () => {
    const store1 = new FsScratchStore();
    const store2 = new FsScratchStore();
    expect(store1.directory).not.toBe(store2.directory);
    // Both should exist
    const { stat } = await import("node:fs/promises");
    await expect(stat(store1.directory)).resolves.toBeDefined();
    await expect(stat(store2.directory)).resolves.toBeDefined();
  });

  it("uses provided baseDir when given", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const base = mkdtempSync(join(tmpdir(), "rolecall-scratch-test-base-"));
    const store = new FsScratchStore(base);
    expect(store.directory).toContain(base);
  });
});

// Additional MemoryScratchStore-specific tests
describe("MemoryScratchStore isolation", () => {
  it("instances are independent", async () => {
    const store1 = new MemoryScratchStore();
    const store2 = new MemoryScratchStore();
    await store1.write("key", "value1");
    await store2.write("key", "value2");
    expect(await store1.read("key")).toBe("value1");
    expect(await store2.read("key")).toBe("value2");
  });
});