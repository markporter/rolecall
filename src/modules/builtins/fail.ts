// Built-in module: `fail` — Ansible `fail` alternate (always fails the task).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";

/** @summary Fail the task with a message (Ansible `fail` alternate). Always returns `failed: true`; use with `when` to gate on a condition. @param ctx ModuleContext carrying optional `msg`. @returns A failed ModuleResult. */
export const failModule: Module = {
  name: "fail",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const msg = typeof ctx.args["msg"] === "string" ? String(ctx.args["msg"]) : "failed as requested";
    return { changed: false, failed: true, msg };
  },
};

/** Search metadata for the `fail` module. */
export const meta: ModuleSummary = {
  name: "fail",
  description: "Fail the task with a message (Ansible `fail` alternate). Always returns `failed: true`; pair with `when` to assert a precondition.",
  source: "builtin",
  args: {
    msg: { type: "string", required: false, description: "Failure message." },
  },
  examples: [
    `- fail:
    msg: "bailing out because of X"
    when:
      $eq:
        - $var: vars.epic
        - "X"`,
  ],
};

(failModule as Module & { meta: ModuleSummary }).meta = meta;
export default failModule;
