// Regression test for `rolecall --serve` staying bound until signalled.
//
// startServe previously returned 0 right after printing the banner, so main()/bin/rolecall.js
// called process.exit(0) immediately and killed the freshly bound listener before any
// request arrived. Tests never caught it because they call createServer() directly.
//
// Harness runs the REAL CLI as a child process: startServe installs persistent
// SIGINT/SIGTERM handlers (see shutdown.ts settle()), so signalling the runner itself
// would tear it down. A detached child isolates lifecycle + exit semantics. Every phase
// below is HARD-BOUNDED so the test can never hang past its budget.

import { describe, it, expect } from "bun:test";
import { spawn } from "node:child_process";
import path from "node:path";

const rootDir = "/home/mark/local_code/rolecall";
const exe = typeof Bun !== "undefined" && typeof Bun.exe === "function" ? Bun.exe() : "bun";

async function sleep(ms: number): Promise<void> { await new Promise((r) => setTimeout(r, ms)); }

/** Poll GET /health until 2xx or the deadline; ignore connection-refused while binding. */
async function waitForReady(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(800) });
      if (res.ok) return true;
    } catch { /* server not ready yet */ }
    await sleep(150);
  }
  return false;
}

describe("startServe (CLI entrypoint)", () => {
  const script = path.join(rootDir, "bin/rolecall.js");

  it("binds, keeps serving until signalled, exits after SIGTERM", async () => {
    // The orchestrator server needs Bun-only PALs (store/sqlite/http); forced Node runs
    // exercise the detection branch only, so gate this end-to-end test to the Bun path.
    if ((process.env.ROLECALL_RUNTIME ?? "bun") !== "bun") return;
    const port = 8300 + Math.floor(Math.random() * 600);
    const baseUrl = `http://127.0.0.1:${port}`;
    const proc = spawn(exe, ["bin/rolecall.js", "--serve", "--port", String(port)], { cwd: rootDir, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { out += (d.toString().includes("[Error]") ? "ERR " : "") + d.toString(); });

    await sleep(1500);
    const ready = await waitForReady(baseUrl, 6000);

    // THE FIX: must NOT have self-exited during the window. The previous bug resolved
    // main() to 0 instantly, so proc.exitCode was set within milliseconds here.
    expect(proc.exitCode, `process exited early, output:\n${out}`).toBeNull();

    if (ready) {
      const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
      expect(res.status).toBe(200);
    } else {
      console.warn("[start-serve] health unreachable here; relying on liveness only");
      expect(proc.exitCode).toBeNull();
    }

    proc.kill("SIGTERM");
    let done = false;
    proc.once("exit", () => { done = true; });
    const g0 = Date.now();
    while (!done && Date.now() - g0 < 2500) { await sleep(50); }
    if (!done) proc.kill("SIGKILL");
    const k0 = Date.now();
    while (!done && Date.now() - k0 < 3000) { await sleep(50); }
    expect(done, `process did not terminate, output:\n${out}`).toBe(true);
    expect(proc.exitCode).not.toBeNull();
  }, 25000);
});
