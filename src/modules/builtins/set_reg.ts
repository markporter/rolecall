// Built-in module: `set_reg` — assign runtime register values (the `reg`-namespace
// counterpart to `set_fact`).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";

/** @summary Assign runtime register values from the task args. Persists each key live to the run's `reg` store so downstream tasks read it via `$var: reg.*`; also returns the mapping in `data.set_reg`. @param ctx ModuleContext whose args become register values. @returns ModuleResult with the assigned mapping in `data`. */
export const setRegModule: Module = {
  name: "set_reg",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const reg: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(ctx.args)) {
      if (k === "_check" || k === "check" || k === "cacheable") continue;
      reg[k] = v;
      ctx.setReg?.(k, v);
    }
    return { changed: false, data: { set_reg: reg }, msg: `set ${Object.keys(reg).length} reg value(s)` };
  },
};

/** Search metadata for the `set_reg` module. */
export const meta: ModuleSummary = {
  name: "set_reg",
  description: "Assign runtime register values from the task args. Each key is persisted live to the run's `reg` store and is readable downstream via `$var: reg.<key>`. Use for runtime scratch variables (cached tokens, computed intermediates), not host facts.",
  source: "builtin",
  args: {
    "*": { type: "any", required: false, description: "Arbitrary key/value pairs become register values (read via `$var: reg.*`)." },
  },
  examples: [
    `- set_reg:
    deploy_token: abc123
- debug:
    msg:
      $var: reg.deploy_token`,
  ],
  notes: "Each key is persisted live to the run's `reg` store and is visible to downstream tasks via `$var: reg.foo` (e.g. `{$var: \"reg.foo\"}`). Unlike `set_fact`, these are runtime variables (not host facts). Prefer `set_reg` for runtime scratch values and reserve `set_fact` for genuine persistent host facts.",
};

(setRegModule as Module & { meta: ModuleSummary }).meta = meta;
export default setRegModule;
