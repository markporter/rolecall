// Node-runtime file IO PAL — wraps node:fs/promises readFile/writeFile/access.
import { access, readFile, writeFile } from "node:fs/promises";
import type { FilePAL } from "./types";

/** @summary Node-runtime file PAL backed by node:fs/promises. @param path File path to read. @returns The file contents decoded as UTF-8. */
export class NodeFilePAL implements FilePAL {
  async readText(path: string): Promise<string> {
    return await readFile(path, "utf8");
  }

  /** @summary Writes UTF-8 text to a file, creating or truncating it. @param path Destination file path. @param content Text to write. */
  async writeText(path: string, content: string): Promise<void> {
    await writeFile(path, content, "utf8");
  }

  /** @summary Tests path existence, returning false on any access error (mirrors Bun.file().exists()). @param path Path to probe. @returns True when the path is accessible. */
  async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }
}
