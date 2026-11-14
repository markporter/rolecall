// Built-in module: `wait_for_connection` — Ansible `wait_for_connection`
// alternate. Polls the already-built transport until a trivial command succeeds
// or the timeout elapses. Read-only and safe under --check.

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function positiveNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** @summary Poll the target connection until it can execute a command, or fail after `timeout` seconds. @param ctx ModuleContext carrying `timeout`/`delay`/`sleep` (seconds) and the live connection. @returns ModuleResult; `changed:false` on success, `failed:true` on timeout. */
export const waitForConnectionModule: Module = {
  name: "wait_for_connection",
  supportsCheck: true,
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const timeoutMs = positiveNumber(ctx.args["timeout"], 300) * 1000;
    const delayMs = positiveNumber(ctx.args["delay"], 0) * 1000;
    const sleepMs = Math.max(1, positiveNumber(ctx.args["sleep"], 1) * 1000);
    if (delayMs > 0) await sleep(delayMs);

    const deadline = Date.now() + timeoutMs;
    let attempts = 0;
    let lastError = "connection not ready";
    for (;;) {
      attempts += 1;
      try {
        const res = await ctx.connection.exec("true");
        if (res.exitCode === 0) {
          return {
            changed: false,
            msg: `wait_for_connection: ready after ${attempts} attempt(s)`,
            data: { attempts },
          };
        }
        lastError = res.stderr.trim() || `exit ${res.exitCode}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      if (Date.now() >= deadline) break;
      await sleep(sleepMs);
    }
    return {
      changed: false,
      failed: true,
      msg: `wait_for_connection: timed out after ${timeoutMs / 1000}s (${lastError})`,
      data: { attempts },
    };
  },
};

/** Search metadata for the `wait_for_connection` module. */
export const meta: ModuleSummary = {
  name: "wait_for_connection",
  description:
    "Poll the target transport until it can execute a command (Ansible `wait_for_connection` alternate). Read-only and check-safe.",
  source: "builtin",
  args: {
    timeout: { type: "number", required: false, description: "Maximum wait in seconds (default 300)." },
    delay: { type: "number", required: false, description: "Initial delay before the first probe, in seconds (default 0)." },
    sleep: { type: "number", required: false, description: "Delay between probes, in seconds (default 1)." },
    connect_timeout: {
      type: "number",
      required: false,
      description: "Accepted for Ansible parity; the transport owns its connect timeout.",
    },
  },
  examples: [
    `- wait_for_connection:
    timeout: 120
    sleep: 2`,
  ],
  notes:
    "≠ Ansible `wait_for_connection`: uses the already-built RoleCall transport (no second connection), probing with `true`. `connect_timeout` is accepted but the transport owns connect timeouts.",
};

(waitForConnectionModule as Module & { meta: ModuleSummary }).meta = meta;
export default waitForConnectionModule;
