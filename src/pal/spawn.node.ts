// Node-runtime spawn/supervisor PAL — wraps node:child_process.spawn with piped
// stdio and fully collected output, matching Bun.spawn's argv (no shell) semantics.
import { spawn } from "node:child_process";
import type { SpawnPAL, SpawnOptions, SpawnResult } from "./types";

/** @summary Node-runtime spawn PAL that runs argv without a shell and collects stdout/stderr as UTF-8 strings. @param command Executable plus arguments (command[0] is the program). @param options Optional cwd, environment override, and stdin payload. @returns The child's exit code and captured output. */
export class NodeSpawnPAL implements SpawnPAL {
  spawn(command: string[], options: SpawnOptions = {}): Promise<SpawnResult> {
    return new Promise<SpawnResult>((resolve, reject) => {
      const child = spawn(command[0] ?? "", command.slice(1), {
        cwd: options.cwd,
        env: options.env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", reject);
      child.on("close", (code, signal) => {
        resolve({ exitCode: code ?? (signal !== null ? 1 : 0), stdout, stderr });
      });

      if (options.stdin !== undefined && child.stdin) {
        const data = typeof options.stdin === "string" ? Buffer.from(options.stdin) : options.stdin;
        try {
          child.stdin.write(data);
          child.stdin.end();
        } catch {
          // The child can exit before consuming stdin (EPIPE); output and exit code
          // still resolve via the "close" event, so a write failure is non-fatal.
        }
      }
    });
  }
}
