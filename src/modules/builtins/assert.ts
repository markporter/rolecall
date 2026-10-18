// Batteries-included `assert` module (Todo 12).
//
// Fails (failed:true) when `that` is falsy; used to test failure paths and to
// guard control flow. Shipped in the core executor registry so the control-flow
// engine can be exercised without any transport-side implementation. Metadata is
// auto-collected by builtins/index.ts and also attached here so `searchModules`
// covers it without `registerAllModules`.

import type { Module } from "../../executor/module";
import type { ModuleSummary } from "../search";

function toBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "true") return true;
    if (s === "false") return false;
    return s.length > 0;
  }
  if (typeof v === "number") return v !== 0;
  return Boolean(v);
}

/**
 * @summary Fails (failed:true) when `that` is falsy; otherwise passes. @param args AssertArgs: `that` (condition) and optional `msg`. @returns Module.
 */
export const assertModule: Module = {
  name: "assert",
  async run(ctx) {
    const ok = toBool(ctx.args["that"]);
    if (!ok) {
      return {
        changed: false,
        failed: true,
        msg: String(ctx.args["msg"] ?? "assertion failed"),
      };
    }
    return { changed: false, msg: "ok" };
  },
};

/** Search metadata for the `assert` module (no formal args interface; `that`/`msg` are free-form). */
export const meta: ModuleSummary = {
  name: "assert",
  description:
    "Fails (failed:true) when the `that` condition is falsy; guards control flow and tests failure paths.",
  idempotent: true,
  source: "builtin",
  args: {
    that: {
      type: "unknown",
      required: false,
      description: "Condition that must be truthy for the assertion to pass.",
    },
    msg: { type: "string", required: false, description: "Failure message when `that` is falsy." },
  },
  examples: [
    `- assert:
    that:
      $and:
        - $var: vars.ok
        - $eq:
          - $var: vars.env
          - 'prod'
    msg: 'require ok flag and prod environment'`,
    `- assert:
    that:
      $not:
        $in:
          - $var: vars.cfg_file
          - $var: vars.available_files
    msg: 'configuration file must be supplied'`,
    `- assert:
    that:
      $or:
        - $eq:
          - $var: vars.mode
          - 'dry'
        - $gt:
          - $var: vars.retry_count
          - 0
    msg: 'proceed when dry-run or retries remain'`,
  ],
  notes:
    "≠ Ansible `assert`: conditions use RoleCall's structured `$var`/`$eq`/`$gt`/`$and` expression ops (rendered like any other arg), not Jinja `when`. `that` is truthy-tested; `msg` is the failure text.",
};

(assertModule as Module & { meta: ModuleSummary }).meta = meta;
