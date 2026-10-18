// Built-in module: `user_info` — Ansible `user_info` alternate (lookup a user).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** @summary Look up a user's facts (Ansible `user_info` alternate). @param ctx ModuleContext carrying `name`. @returns ModuleResult with `data.user_info`. */
export const userInfoModule: Module = {
  name: "user_info",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const name = typeof ctx.args["name"] === "string" ? String(ctx.args["name"]) : "";
    if (!name) return { changed: false, failed: true, msg: "user_info: 'name' required" };
    const pw = await ctx.connection.exec(`getent passwd ${shQuote(name)}`);
    if (pw.exitCode !== 0) return { changed: false, failed: true, msg: `user_info: user ${name} not found` };
    const f = pw.stdout.trim().split(":");
    const groupsOut = await ctx.connection.exec(`id -nG ${shQuote(name)}`);
    const groups = (groupsOut.stdout ?? "").trim().split(/\s+/).filter(Boolean);
    return {
      changed: false,
      skipped: false,
      msg: `user_info: ${name}`,
      data: { user_info: { name: f[0], uid: Number(f[2]), gid: Number(f[3]), gecos: f[4], home: f[5], shell: f[6], groups } },
    };
  },
};

/** Search metadata for the `user_info` module. */
export const meta: ModuleSummary = {
  name: "user_info",
  description: "Look up a user's uid/gid/home/shell/groups (Ansible `user_info` alternate). Returns `data.user_info`.",
  source: "builtin",
  args: {
    name: { type: "string", required: true, description: "User name to look up." },
  },
  examples: [
    `- user_info:
    name: deploy`,
  ],
  notes: "≠ Ansible `user_info`: relies on getent/id (POSIX); no `forks`/parallel gather. Mirrors the `user` module's read side.",
};

(userInfoModule as Module & { meta: ModuleSummary }).meta = meta;
export default userInfoModule;
