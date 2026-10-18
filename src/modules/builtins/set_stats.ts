// Built-in module: `set_stats` — Ansible `set_stats` alternate (surface run stats).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";

/** @summary Surface run stats (Ansible `set_stats` alternate). Each key in `data` is merged into the run-level stat store (object payloads deep-merge; scalars overwrite), so stats aggregate across plays/hosts for the life of the run. @param ctx ModuleContext carrying `data`. @returns ModuleResult with `data.set_stats`. */
export const setStatsModule: Module = {
  name: "set_stats",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const data = ctx.args["data"];
    if (isPlainObject(data)) {
      for (const [k, v] of Object.entries(data)) ctx.setStat?.(k, v);
    }
    return { changed: false, skipped: false, msg: "set_stats: recorded", data: { set_stats: data } };
  },
};

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Search metadata for the `set_stats` module. */
export const meta: ModuleSummary = {
  name: "set_stats",
  description: "Surface run stats (Ansible `set_stats` alternate). Returns `data.set_stats`.",
  source: "builtin",
  args: {
    data: { type: "object", required: true, description: "Stats payload to surface." },
  },
  examples: [
    `- set_stats:
    data:
      deployed: true`,
  ],
  notes: "Each key of `data` is aggregated into the run-level stat store (objects deep-merge, scalars overwrite) and persists for the life of the run; the payload is also returned in `data.set_stats`.",
};

(setStatsModule as Module & { meta: ModuleSummary }).meta = meta;
export default setStatsModule;
