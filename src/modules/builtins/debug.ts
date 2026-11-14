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
    const hasVar = ctx.args["var"] !== undefined;
    const payload = hasVar ? { var: ctx.args["var"] } : ctx.args;
    return {
      changed: false,
      stdout: JSON.stringify(payload),
      data: { args: ctx.args, ...(hasVar ? { var: ctx.args["var"] } : {}) },
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
  args: {
    msg: { type: "unknown", required: false, description: "Message or structured value to print." },
    var: { type: "unknown", required: false, description: "Value to print under a `var` key (Ansible parity)." },
    verbosity: {
      type: "number",
      required: false,
      description: "Accepted for Ansible parity; RoleCall has no run verbosity threshold, so the value is echoed but never suppresses output.",
    },
  },
  examples: [
    `- debug:
    msg:
      $concat:
        - deploying
        - ' '
        -       $var: vars.app_name`,
  ],
  notes:
    "≠ Ansible `debug`: `var` prints its resolved value under a `var` key; `verbosity` is accepted but does not suppress output because RoleCall has no run-level verbosity threshold.",
};

(debugModule as Module & { meta: ModuleSummary }).meta = meta;
