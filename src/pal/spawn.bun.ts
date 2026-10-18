// Bun-native spawn/supervisor PAL — wraps Bun.spawn.
import type { SpawnPAL, SpawnOptions, SpawnResult } from "./types";

export class BunSpawnPAL implements SpawnPAL {
  async spawn(command: string[], options: SpawnOptions = {}): Promise<SpawnResult> {
    const proc = Bun.spawn(command, {
      cwd: options.cwd,
      env: options.env,
      stdout: "pipe",
      stderr: "pipe",
      ...(options.stdin !== undefined
        ? { stdin: typeof options.stdin === "string" ? new TextEncoder().encode(options.stdin) : options.stdin }
        : {}),
    });

    const [stdout, stderr] = await Promise.all([
      proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
      proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
    ]);
    const exitCode = await proc.exited;
    return { exitCode, stdout, stderr };
  }
}
