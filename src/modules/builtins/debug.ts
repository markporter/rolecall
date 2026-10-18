// Batteries-included `debug` module (Todo 12).
//
// Echoes its (rendered) args; never changes anything. Shipped in the core
// executor registry so the control-flow engine can be exercised without any
// transport-side implementation. Metadata is auto-collected by builtins/index.ts
// and also attached here so `searchModules` covers it without `registerAllModules`.

import type { Module } from "../../executor/module";
import type { ModuleSummary } from "../search";

/**
 * @summary Echoes the (rendered) task args as stdout; never changes target state. @param args Arbitrary task args, echoed verbatim. @returns Module.
 */
export const debugModule: Module = {
  name: "debug",
  async run(ctx) {
    return {
      changed: false,
      stdout: JSON.stringify(ctx.args),
      data: { args: ctx.args },
    };
  },
};

/** Search metadata for the `debug` module (no formal args interface; args is free-form). */
export const meta: ModuleSummary = {
  name: "debug",
  description:
    "Echoes the (rendered) task args as stdout; never changes target state. Useful for control-flow diagnostics.",
  idempotent: true,
  source: "builtin",
  args: {},
  examples: [
    `- debug:
    msg:
      $concat:
        - deploying
        - ' '
        - $var: vars.app_name`,
  ],
};

(debugModule as Module & { meta: ModuleSummary }).meta = meta;
