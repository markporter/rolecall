// Built-in module: `wait_for` — Ansible `wait_for` alternate (poll a port/path/condition).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type WaitState = "started" | "present" | "stopped" | "absent" | "drained";

const WAIT_STATES: readonly WaitState[] = ["started", "present", "stopped", "absent", "drained"];

function isWaitState(value: string): value is WaitState {
  return (WAIT_STATES as readonly string[]).includes(value);
}

/** @summary Poll until a port/path condition holds (Ansible `wait_for` alternate). `state` selects `started`/`present` (port open or path exists), `stopped`/`absent` (port closed or path gone), or `drained` (no established connections on `port`). `search_regex` additionally requires path contents or socket output to match. Reports `changed: false` once the condition holds; fails if not met within `timeout`. @param ctx ModuleContext carrying `port`/`host` or `path`, plus optional `state`/`search_regex` and `timeout`/`delay` (seconds). @returns ModuleResult; `failed` if the timeout elapses or the args are invalid. */
export const waitForModule: Module = {
  name: "wait_for",
  supportsCheck: true,
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const args = ctx.args as Record<string, unknown>;
    const port = Number(args["port"] ?? 0);
    const host = typeof args["host"] === "string" ? String(args["host"]) : "127.0.0.1";
    const path = typeof args["path"] === "string" ? String(args["path"]) : "";
    const searchRegex =
      typeof args["search_regex"] === "string" ? String(args["search_regex"]) : "";
    const rawState = typeof args["state"] === "string" ? String(args["state"]) : "started";
    const timeout = Number(args["timeout"] ?? 300);
    const delay = Number(args["delay"] ?? 0);

    if (!isWaitState(rawState)) {
      return {
        changed: false,
        failed: true,
        msg: `wait_for: invalid state ${shQuote(rawState)} (expected one of ${WAIT_STATES.join(", ")})`,
      };
    }
    const state = rawState;

    if (state === "drained" && !port) {
      return { changed: false, failed: true, msg: "wait_for: state `drained` requires `port`" };
    }
    if (!path && !port && state !== "drained") {
      return {
        changed: false,
        failed: true,
        msg: "wait_for: nothing to wait for (set `path`, `port`, or `state: drained`)",
      };
    }

    if (delay) await sleep(delay * 1000);
    const deadline = Date.now() + timeout * 1000;
    const wantPresent = state === "started" || state === "present";

    for (;;) {
      if (state === "drained") {
        const ss = await ctx.connection.exec(
          `ss -Htn state established ${shQuote(`( sport = :${port} )`)}`,
        );
        let remaining: boolean;
        if (ss.exitCode === 0) {
          remaining = ss.stdout.trim() !== "";
        } else {
          const netstat = await ctx.connection.exec("netstat -an");
          remaining = netstat.stdout
            .split("\n")
            .some(
              (line) => line.includes("ESTABLISHED") && new RegExp(`:${port}(?!\\d)`).test(line),
            );
        }
        if (!remaining) {
          return { changed: false, msg: `wait_for: no established connections on port ${port}` };
        }
        if (Date.now() >= deadline) {
          return {
            changed: false,
            failed: true,
            msg: `wait_for: established connections on port ${port} after ${timeout}s`,
          };
        }
        await sleep(1000);
        continue;
      }

      if (path) {
        if (wantPresent) {
          const probe = searchRegex
            ? `test -e ${shQuote(path)} && grep -q -E ${shQuote(searchRegex)} ${shQuote(path)}`
            : `test -e ${shQuote(path)}`;
          const r = await ctx.connection.exec(probe);
          if (r.exitCode === 0) {
            return {
              changed: false,
              msg: searchRegex
                ? `wait_for: ${path} matches ${searchRegex}`
                : `wait_for: ${path} present`,
            };
          }
          if (Date.now() >= deadline) {
            return {
              changed: false,
              failed: true,
              msg: searchRegex
                ? `wait_for: ${path} did not match ${searchRegex} within ${timeout}s`
                : `wait_for: ${path} not present within ${timeout}s`,
            };
          }
        } else {
          const r = await ctx.connection.exec(`test -e ${shQuote(path)}`);
          if (r.exitCode !== 0) {
            return { changed: false, msg: `wait_for: ${path} absent` };
          }
          if (Date.now() >= deadline) {
            return {
              changed: false,
              failed: true,
              msg: `wait_for: ${path} still present within ${timeout}s`,
            };
          }
        }
        await sleep(1000);
        continue;
      }

      const probe = `exec 3<>/dev/tcp/${shQuote(host)}/${port} 2>/dev/null && exec 3>&-`;
      if (wantPresent) {
        const openProbe = searchRegex
          ? `timeout 1 bash -c ${shQuote(`cat < /dev/tcp/${host}/${port}`)} 2>/dev/null | grep -q -E ${shQuote(searchRegex)}`
          : probe;
        const r = await ctx.connection.exec(openProbe);
        if (r.exitCode === 0) {
          return {
            changed: false,
            msg: searchRegex
              ? `wait_for: ${host}:${port} output matches ${searchRegex}`
              : `wait_for: ${host}:${port} open`,
          };
        }
        if (Date.now() >= deadline) {
          return {
            changed: false,
            failed: true,
            msg: searchRegex
              ? `wait_for: ${host}:${port} output did not match ${searchRegex} within ${timeout}s`
              : `wait_for: ${host}:${port} not open within ${timeout}s`,
          };
        }
      } else {
        const r = await ctx.connection.exec(probe);
        if (r.exitCode !== 0) {
          return { changed: false, msg: `wait_for: ${host}:${port} closed` };
        }
        if (Date.now() >= deadline) {
          return {
            changed: false,
            failed: true,
            msg: `wait_for: ${host}:${port} still open within ${timeout}s`,
          };
        }
      }
      await sleep(1000);
    }
  },
};

/** Search metadata for the `wait_for` module. */
export const meta: ModuleSummary = {
  name: "wait_for",
  description:
    "Poll until a port is open/closed, a path exists/is absent, or no established connections remain (Ansible `wait_for` alternate). Reports `changed: false` once satisfied; fails after `timeout` seconds.",
  source: "builtin",
  args: {
    port: { type: "number", required: false, description: "TCP port to probe (with `host`)." },
    host: { type: "string", required: false, description: "Host to probe (default 127.0.0.1)." },
    path: { type: "string", required: false, description: "Filesystem path that must exist or be absent." },
    state: {
      type: "string",
      required: false,
      description:
        "`started`/`present` (default) wait for the port open or path present; `stopped`/`absent` wait for the port closed or path gone; `drained` waits for no established connections on `port`.",
    },
    search_regex: {
      type: "string",
      required: false,
      description:
        "With `path` (started/present), require the path contents to match this regex; with `port`, require the socket output to match.",
    },
    timeout: { type: "number", required: false, description: "Seconds to wait (default 300)." },
    delay: { type: "number", required: false, description: "Seconds to wait before first probe." },
  },
  examples: [
    `- wait_for:
    port: 8000
    host: 127.0.0.1
    timeout: 60`,
    `- wait_for:
    path: /var/run/app.sock
    timeout: 30`,
    `- wait_for:
    path: /var/run/app.pid
    search_regex: '^[0-9]+$'
    timeout: 30`,
    `- wait_for:
    port: 5432
    state: drained
    timeout: 120`,
  ],
  notes:
    "≠ Ansible `wait_for`: port probing uses bash `/dev/tcp`; `state: drained` inspects established connections via `ss` (falling back to `netstat -an`) rather than `active_connection`.",
};

(waitForModule as Module & { meta: ModuleSummary }).meta = meta;
export default waitForModule;
