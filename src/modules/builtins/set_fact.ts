// Built-in module: `set_fact` — Ansible `set_fact` alternate (host-var assignment).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";

/** @summary Assign host variables from the task args (Ansible `set_fact` alternate). Persists each key live to the host's fact map so downstream tasks read it via `$var: facts.*`; also returns the mapping in `data.set_fact`. @param ctx ModuleContext whose args become the facts. @returns ModuleResult with the assigned mapping in `data`. */
export const setFactModule: Module = {
  name: "set_fact",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const facts: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(ctx.args)) {
      if (k === "_check" || k === "check" || k === "cacheable") continue;
      facts[k] = v;
      ctx.setFact?.(k, v);
    }
    return { changed: false, data: { set_fact: facts }, msg: `set ${Object.keys(facts).length} fact(s)` };
  },
};

/** Search metadata for the `set_fact` module. */
export const meta: ModuleSummary = {
  name: "set_fact",
  description: "Assign host variables from the task args (Ansible `set_fact` alternate). Each key is persisted live to the host's fact map and is readable downstream via `$var: facts.<key>`.",
  source: "builtin",
  args: {
    "*": { type: "any", required: false, description: "Arbitrary key/value pairs become facts." },
  },
  examples: [
    `- set_fact:
    foo: bar
- debug:
    msg:
      $var: facts.foo`,
  ],
  notes: "Like Ansible `set_fact`, each key is persisted live to the host's fact map and is visible to downstream tasks via `$var: facts.foo` (e.g. `{$var: \"facts.foo\"}`). Reserve this for values that are genuinely a persistent fact about the host; use `set_reg` for runtime scratch variables.",
};

(setFactModule as Module & { meta: ModuleSummary }).meta = meta;
export default setFactModule;
