// Built-in module: `acl` — Ansible `acl` alternate (set filesystem ACLs).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote, wrapCommand } from "./fs";

/** @summary Set or remove a filesystem ACL entry (Ansible `acl` alternate). @param ctx ModuleContext carrying `path`, `entity`, `etype`, `permissions`, `state`, `default`. @returns ModuleResult; `skipped` when already in desired state. */
export const aclModule: Module = {
  name: "acl",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const a = ctx.args;
    const path = typeof a["path"] === "string" ? String(a["path"]) : "";
    const entity = typeof a["entity"] === "string" ? String(a["entity"]) : "";
    const etype = (typeof a["etype"] === "string" ? String(a["etype"]) : "user") as "user" | "group";
    const perms = typeof a["permissions"] === "string" ? String(a["permissions"]) : "";
    const state = (typeof a["state"] === "string" ? String(a["state"]) : "present") as "present" | "absent";
    const isDefault = Boolean(a["default"]);
    const recursive = Boolean(a["recursive"]);
    if (!path || !entity || !perms) return { changed: false, failed: true, msg: "acl: 'path', 'entity', 'permissions' required" };

    const flag = isDefault ? "d:" : "";
    const cur = await ctx.connection.exec(`getfacl -p ${shQuote(path)} 2>/dev/null | grep -E "^${isDefault ? "default:" : ""}${etype}:${entity}:"`);
    const current = (cur.stdout ?? "").trim();
    const wanted = `${flag}${etype}:${entity}:${perms}`;

    if (state === "absent") {
      if (!current) return { changed: false, skipped: true, msg: `acl: ${etype}:${entity} absent` };
      const cmd = `setfacl ${recursive ? "-R " : ""}-x ${flag}${etype}:${entity} ${shQuote(path)}`;
      const run = wrapCommand(cmd, { become: Boolean(ctx.become), becomeUser: ctx.become_user, environment: ctx.environment });
      const res = await ctx.connection.exec(run);
      if (res.exitCode !== 0) return { changed: false, failed: true, msg: `acl: failed: ${res.stderr}` };
      return { changed: true, msg: `acl: removed ${etype}:${entity}` };
    }

    if (current === wanted) return { changed: false, skipped: true, msg: `acl: ${wanted} unchanged` };
    const cmd = `setfacl ${recursive ? "-R " : ""}-m ${wanted} ${shQuote(path)}`;
    const run = wrapCommand(cmd, { become: Boolean(ctx.become), becomeUser: ctx.become_user, environment: ctx.environment });
    const res = await ctx.connection.exec(run);
    if (res.exitCode !== 0) return { changed: false, failed: true, msg: `acl: failed: ${res.stderr}` };
    return { changed: true, msg: `acl: set ${wanted}` };
  },
};

/** Search metadata for the `acl` module. */
export const meta: ModuleSummary = {
  name: "acl",
  description: "Set or remove a filesystem ACL entry (Ansible `acl` alternate). Wraps `setfacl`/`getfacl`.",
  source: "builtin",
  args: {
    path: { type: "string", required: true, description: "Target file/dir." },
    entity: { type: "string", required: true, description: "User or group name." },
    etype: { type: "user | group", required: false, description: "Entity type (default user)." },
    permissions: { type: "string", required: true, description: "ACL permissions, e.g. rwx." },
    state: { type: "present | absent", required: false, description: "present (default)." },
    default: { type: "boolean", required: false, description: "Set a default ACL." },
    recursive: { type: "boolean", required: false, description: "Apply the ACL recursively (-R) to the path." },
  },
  examples: [
    `- acl:
    path: /srv/shared
    entity: deploy
    etype: user
    permissions: rwx`,
  ],
  notes: "≠ Ansible `acl`: no `follow`/mask recalculation toggles; single entry per task (recursive applies -R to that entry).",
};

(aclModule as Module & { meta: ModuleSummary }).meta = meta;
export default aclModule;
