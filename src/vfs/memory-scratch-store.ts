/**
 * MemoryScratchStore — in-memory ScratchVfs implementation.
 *
 * Stores entries in a `Map<string, string>`. All operations resolve immediately
 * (async for interface uniformity). `read`/`delete` of a missing name reject
 * with an error whose `code` is `"ENOENT"`. `exists` returns `false` for
 * missing names. `list` returns all keys in the map (order not guaranteed).
 */
import type { ScratchVfs } from "./scratch.js";

export class MemoryScratchStore implements ScratchVfs {
  #store = new Map<string, string>();

  async write(name: string, data: string): Promise<void> {
    this.#store.set(name, data);
  }

  async read(name: string): Promise<string> {
    const value = this.#store.get(name);
    if (value === undefined) {
      const error = new Error(`Scratch entry not found: ${name}`);
      error.name = "NotFoundError";
      (error as NodeJS.ErrnoException).code = "ENOENT";
      throw error;
    }
    return value;
  }

  async exists(name: string): Promise<boolean> {
    return this.#store.has(name);
  }

  async delete(name: string): Promise<void> {
    this.#store.delete(name);
  }

  async list(): Promise<string[]> {
    return Array.from(this.#store.keys());
  }
}