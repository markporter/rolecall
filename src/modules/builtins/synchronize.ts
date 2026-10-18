// Built-in module: `synchronize` — Ansible `synchronize` alternate (rsync wrapper, target-side).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote, wrapCommand } from "./fs";

/** @summary rsync files on the target (Ansible `synchronize` alternate, target-side). @param ctx ModuleContext carrying `src`, `dest`, `delete`, `recursive`, `rsync_opts`. @returns ModuleResult (always reports changed). */
export const synchronizeModule: Module = {
  name: "synchronize",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const a = ctx.args;
    const src = typeof a["src"] === "string" ? String(a["src"]) : "";
    const dest = typeof a["dest"] === "string" ? String(a["dest"]) : "";
    if (!src || !dest) return { changed: false, failed: true, msg: "synchronize: 'src' and 'dest' required" };
    const del = Boolean(a["delete"]);
    const recursive = a["recursive"] !== false;
    const extra = typeof a["rsync_opts"] === "string" ? String(a["rsync_opts"]) : "";
    const flags = [recursive ? "-a" : "-r", del ? "--delete" : "", extra].filter(Boolean).join(" ");
    const cmd = `rsync ${flags} ${shQuote(src)} ${shQuote(dest)}`;
    const res = await ctx.connection.exec(wrapCommand(cmd, { become: Boolean(ctx.become), becomeUser: ctx.become_user, environment: ctx.environment }));
    if (res.exitCode !== 0) return { changed: false, failed: true, msg: `synchronize: failed: ${res.stderr}` };
    return { changed: true, msg: `synchronize: ${src} -> ${dest}`, data: { src, dest } };
  },
};

/** Search metadata for the `synchronize` module. */
export const meta: ModuleSummary = {
  name: "synchronize",
  description: "rsync files on the target (Ansible `synchronize` alternate). NOTE: runs rsync on the target itself, not controller→target.",
  source: "builtin",
  args: {
    src: { type: "string", required: true, description: "Source path (on target)." },
    dest: { type: "string", required: true, description: "Destination path (on target)." },
    delete: { type: "boolean", required: false, description: "Mirror deletions (--delete)." },
    recursive: { type: "boolean", required: false, description: "Use -a (default true)." },
  },
  examples: [
    `- synchronize:
    src: /srv/www/
    dest: /var/www/
    delete: true`,
  ],
  notes: "≠ Ansible `synchronize`: Ansible runs rsync from the controller to the target; RoleCall runs rsync on the target (src/dest are both on the target). No `mode: pull` controller semantics.",
};

(synchronizeModule as Module & { meta: ModuleSummary }).meta = meta;
export default synchronizeModule;
