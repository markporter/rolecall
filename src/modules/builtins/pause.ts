// Built-in module: `pause` — Ansible `pause` alternate (sleep; no interactive prompt).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** @summary Pause execution for N seconds (Ansible `pause` alternate). @param ctx ModuleContext carrying `seconds`/`minutes`. @returns ModuleResult (no interactive prompt in RoleCall). */
export const pauseModule: Module = {
  name: "pause",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const a = ctx.args;
    const seconds = a["seconds"] != null ? Number(a["seconds"]) : a["minutes"] != null ? Number(a["minutes"]) * 60 : 0;
    if (!Number.isFinite(seconds) || seconds <= 0) return { changed: false, skipped: true, msg: "pause: no duration given" };
    await sleep(Math.round(seconds * 1000));
    return { changed: false, skipped: true, msg: `pause: waited ${seconds}s` };
  },
};

/** Search metadata for the `pause` module. */
export const meta: ModuleSummary = {
  name: "pause",
  description: "Pause execution for N seconds (Ansible `pause` alternate). No interactive prompt — RoleCall runs non-interactively.",
  source: "builtin",
  args: {
    seconds: { type: "number", required: false, description: "Seconds to wait." },
    minutes: { type: "number", required: false, description: "Minutes to wait." },
  },
  examples: [
    `- pause:
    seconds: 30`,
  ],
  notes: "≠ Ansible `pause`: `prompt` is ignored (RoleCall is non-interactive); only timed sleeps are supported.",
};

(pauseModule as Module & { meta: ModuleSummary }).meta = meta;
export default pauseModule;
