// Built-in module: `group_by` — add the current host to dynamic groups during a
// run (Ansible `group_by` alternate).
//
// The module never mutates the target host: it calls `ctx.addHost` with the
// current host name, the key plus any parents as the group list, and an empty
// host-vars map. Group membership is therefore resolved by the executor's
// run-level dynamic inventory (see `add_host`). `changed` is always false because
// grouping is run-state bookkeeping, not remote configuration.

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";

const MODULE_NAME = "group_by";

/** @summary Arguments for the `group_by` module. @property key Group name to add the current host to (required). @property parents Additional groups the host should join alongside `key`; a comma-separated string or an array of group names. */
export interface GroupByArgs {
  /** Group name derived from the task (required). */
  key: string;
  /** Additional parent group(s) to add alongside `key`. */
  parents?: string | string[];
}

/** Search metadata for the `group_by` module (auto-collected by builtins/index.ts). */
export const meta: ModuleSummary = {
  name: MODULE_NAME,
  description:
    "Add the current host to dynamic groups for the remainder of the run (Ansible `group_by` alternate). Calls the executor's in-memory `addHost`; never changes the target.",
  source: "builtin",
  args: {
    key: { type: "string", required: true, description: "Group name to add the current host to." },
    parents: {
      type: "string | string[]",
      required: false,
      description: "Additional group(s) the host joins alongside `key`.",
    },
  },
  examples: [
    `- group_by:
    key: rolecall_web`,
    `- group_by:
    key: rolecall_linux
    parents:
      - rolecall_all
      - rolecall_managed`,
  ],
  notes:
    "≠ Ansible `group_by`: no expression templating is evaluated by the module itself (render `key`/`parents` with `$var` or task templating first). Membership is recorded through the executor's runtime `addHost`, so it affects later tasks in the same run only.",
};

/** Normalize `parents` to a trimmed string array, or null when the value is not a string/string array. */
function normalizeParents(value: GroupByArgs["parents"]): string[] | null {
  if (value === undefined || value === null) return [];
  if (typeof value === "string") {
    return value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    if (!value.every((entry) => typeof entry === "string")) return null;
    return value.map((entry) => entry.trim()).filter(Boolean);
  }
  return null;
}

/** @summary Add the current host to `key` plus optional `parents` via the executor's dynamic inventory. @param ctx ModuleContext carrying `key`/`parents` and the optional `addHost` callback. @returns ModuleResult with `data.group_by.{key,parents}`; `changed` is always false. */
export const groupByModule: Module = {
  name: MODULE_NAME,
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const args = ctx.args as unknown as GroupByArgs;
    const key = typeof args.key === "string" ? args.key.trim() : "";
    if (!key) {
      return { changed: false, failed: true, msg: "group_by: 'key' is required" };
    }
    const parents = normalizeParents(args.parents);
    if (parents === null) {
      return {
        changed: false,
        failed: true,
        msg: "group_by: 'parents' must be a string or an array of strings",
      };
    }

    const groups = [key, ...parents];
    ctx.addHost?.(ctx.host, groups, {});
    return {
      changed: false,
      data: { group_by: { key, parents } },
      msg: `group_by: ${ctx.host} -> ${groups.join(", ")}`,
    };
  },
};

(groupByModule as Module & { meta: ModuleSummary }).meta = meta;
export default groupByModule;
