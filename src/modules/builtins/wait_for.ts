// Built-in module: `wait_for` — Ansible `wait_for` alternate (poll a port/path/condition).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** @summary Poll until a port is open or a path exists (Ansible `wait_for` alternate). Reports `changed: false` once the condition holds; fails if not met within `timeout`. @param ctx ModuleContext carrying `port`/`host` or `path`, plus `timeout`/`delay` (seconds). @returns ModuleResult; `failed` if the timeout elapses. */
export const waitForModule: Module = {
  name: "wait_for",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const args = ctx.args as Record<string, unknown>;
    const port = Number(args["port"] ?? 0);
    const host = typeof args["host"] === "string" ? String(args["host"]) : "127.0.0.1";
    const path = typeof args["path"] === "string" ? String(args["path"]) : "";
    const timeout = Number(args["timeout"] ?? 300);
    const delay = Number(args["delay"] ?? 0);
    if (delay) await sleep(delay * 1000);
    const deadline = Date.now() + timeout * 1000;

    if (path) {
      while (Date.now() < deadline) {
        const r = await ctx.connection.exec(`test -e ${shQuote(path)}`);
        if (r.exitCode === 0) return { changed: false, msg: `wait_for: ${path} present` };
        await sleep(1000);
      }
      return { changed: false, failed: true, msg: `wait_for: ${path} not present within ${timeout}s` };
    }
    if (port) {
      while (Date.now() < deadline) {
        const probe = `exec 3<>/dev/tcp/${shQuote(host)}/${port} 2>/dev/null && exec 3>&-`;
        const r = await ctx.connection.exec(probe);
        if (r.exitCode === 0) return { changed: false, msg: `wait_for: ${host}:${port} open` };
        await sleep(1000);
      }
      return { changed: false, failed: true, msg: `wait_for: ${host}:${port} not open within ${timeout}s` };
    }
    return { changed: false, msg: "wait_for: nothing to wait for (set `port`/`host` or `path`)" };
  },
};

/** Search metadata for the `wait_for` module. */
export const meta: ModuleSummary = {
  name: "wait_for",
  description: "Poll until a TCP port is open or a path exists (Ansible `wait_for` alternate). Reports `changed: false` once satisfied; fails after `timeout` seconds.",
  source: "builtin",
  args: {
    port: { type: "number", required: false, description: "TCP port to probe (with `host`)." },
    host: { type: "string", required: false, description: "Host to probe (default 127.0.0.1)." },
    path: { type: "string", required: false, description: "Filesystem path that must exist." },
    timeout: { type: "number", required: false, description: "Seconds to wait (default 300)." },
    delay: { type: "number", required: false, description: "Seconds to wait before first probe." },
  },
  examples: [
    `- wait_for:
    port: 8000
    host: "{{ vars.app_host }}"
    timeout: 60`,
    `- wait_for:
    path: /var/run/app.sock
    timeout: 30`,
  ],
  notes: "≠ Ansible `wait_for`: only `port`/`path` polling is implemented (no `search_regex` on socket output, no `active_connection` states). Port probing uses bash `/dev/tcp`.",
};

(waitForModule as Module & { meta: ModuleSummary }).meta = meta;
export default waitForModule;
