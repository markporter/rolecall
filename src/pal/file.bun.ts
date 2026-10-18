// Bun-native file IO PAL — wraps Bun.file / Bun.write.
import type { FilePAL } from "./types";

export class BunFilePAL implements FilePAL {
  async readText(path: string): Promise<string> {
    return await Bun.file(path).text();
  }

  async writeText(path: string, content: string): Promise<void> {
    await Bun.write(path, content);
  }

  async exists(path: string): Promise<boolean> {
    return await Bun.file(path).exists();
  }
}
