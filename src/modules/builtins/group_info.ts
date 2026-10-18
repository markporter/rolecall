// Built-in module: `group_info` — Ansible `group_info` alternate (lookup a group).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** @summary Look up a group's facts (Ansible `group_info` alternate). @param ctx ModuleContext carrying `name`. @returns ModuleResult with `data.group_info`. */
export const groupInfoModule: Module = {
  name: "group_info",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const name = typeof ctx.args["name"] === "string" ? String(ctx.args["name"]) : "";
    if (!name) return { changed: false, failed: true, msg: "group_info: 'name' required" };
    const gr = await ctx.connection.exec(`getent group ${shQuote(name)}`);
    if (gr.exitCode !== 0) return { changed: false, failed: true, msg: `group_info: group ${name} not found` };
    const f = gr.stdout.trim().split(":");
    return {
      changed: false,
      skipped: false,
      msg: `group_info: ${name}`,
      data: { group_info: { name: f[0], gid: Number(f[2]), members: (f[3] ?? "").split(",").filter(Boolean) } },
    };
  },
};

/** Search metadata for the `group_info` module. */
export const meta: ModuleSummary = {
  name: "group_info",
  description: "Look up a group's gid/members (Ansible `group_info` alternate). Returns `data.group_info`.",
  source: "builtin",
  args: {
    name: { type: "string", required: true, description: "Group name to look up." },
  },
  examples: [
    `- group_info:
    name: docker`,
  ],
  notes: "≠ Ansible `group_info`: relies on getent group (POSIX); no `forks`/parallel gather.",
};

(groupInfoModule as Module & { meta: ModuleSummary }).meta = meta;
export default groupInfoModule;
