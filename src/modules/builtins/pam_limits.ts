// Built-in module: `pam_limits` — Ansible `pam_limits` alternate (manage limits.conf).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote, wrapCommand } from "./fs";

/** @summary Manage an /etc/security/limits.conf entry (Ansible `pam_limits` alternate). @param ctx ModuleContext carrying `domain`, `type`, `item`, `value`, `dest`, `state`. @returns ModuleResult; `skipped` when already in desired state. */
export const pamLimitsModule: Module = {
  name: "pam_limits",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const a = ctx.args;
    const domain = typeof a["domain"] === "string" ? String(a["domain"]) : "";
    const type = typeof a["type"] === "string" ? String(a["type"]) : "";
    const item = typeof a["item"] === "string" ? String(a["item"]) : "";
    const value = typeof a["value"] === "string" ? String(a["value"]) : "";
    const dest = typeof a["dest"] === "string" ? String(a["dest"]) : "/etc/security/limits.conf";
    const state = (typeof a["state"] === "string" ? String(a["state"]) : "present") as "present" | "absent";
    if (!domain || !type || !item || !value) return { changed: false, failed: true, msg: "pam_limits: 'domain', 'type', 'item', 'value' required" };

    const line = `${domain} ${type} ${item} ${value}`;
    const cur = await ctx.connection.exec(`grep -qxF ${shQuote(line)} ${shQuote(dest)} 2>/dev/null`);
    const present = cur.exitCode === 0;

    if (state === "absent") {
      if (!present) return { changed: false, skipped: true, msg: `pam_limits: entry absent` };
      const cmd = `awk -v l=${shQuote(line)} '$0 != l' ${shQuote(dest)} > ${shQuote(dest)}.tmp && cat ${shQuote(dest)}.tmp > ${shQuote(dest)} && rm -f ${shQuote(dest)}.tmp`;
      const run = wrapCommand(cmd, { become: Boolean(ctx.become), becomeUser: ctx.become_user, environment: ctx.environment });
      const res = await ctx.connection.exec(run);
      if (res.exitCode !== 0) return { changed: false, failed: true, msg: `pam_limits: failed: ${res.stderr}` };
      return { changed: true, msg: `pam_limits: removed ${line}` };
    }
    const useFirstMatch = Boolean(a["use_first_match"]);
    if (present) return { changed: false, skipped: true, msg: `pam_limits: ${line} unchanged` };
    let cmd: string;
    if (useFirstMatch) {
      cmd = `mkdir -p ${shQuote(dest.replace(/[^/]+$/, ""))} && awk -v l=${shQuote(line)} 'BEGIN{d=0} $1==${shQuote(domain)} && $2==${shQuote(type)} && $3==${shQuote(item)} && d==0 {print l; d=1; next} {print}' ${shQuote(dest)} > ${shQuote(dest)}.tmp && cat ${shQuote(dest)}.tmp > ${shQuote(dest)} && rm -f ${shQuote(dest)}.tmp`;
    } else {
      cmd = `mkdir -p ${shQuote(dest.replace(/[^/]+$/, ""))} && sh -c 'echo ${shQuote(line)} >> ${shQuote(dest)}'`;
    }
    const run = wrapCommand(cmd, { become: Boolean(ctx.become), becomeUser: ctx.become_user, environment: ctx.environment });
    const res = await ctx.connection.exec(run);
    if (res.exitCode !== 0) return { changed: false, failed: true, msg: `pam_limits: failed: ${res.stderr}` };
    return { changed: true, msg: `pam_limits: added ${line}` };
  },
};

/** Search metadata for the `pam_limits` module. */
export const meta: ModuleSummary = {
  name: "pam_limits",
  description: "Manage an /etc/security/limits.conf entry (Ansible `pam_limits` alternate). Adds/removes a `domain type item value` line.",
  source: "builtin",
  args: {
    domain: { type: "string", required: true, description: "Limit domain (user/group/*).", },
    type: { type: "soft | hard | -", required: true, description: "Limit type." },
    item: { type: "string", required: true, description: "Limit item (e.g. nofile)." },
    value: { type: "string", required: true, description: "Limit value." },
    dest: { type: "string", required: false, description: "limits.conf path (default /etc/security/limits.conf)." },
    state: { type: "present | absent", required: false, description: "present (default)." },
    use_first_match: { type: "boolean", required: false, description: "When present and an exact match is absent, replace the first line beginning with `domain type item ` rather than appending a new line." },
  },
  examples: [
    `- pam_limits:
    domain: "*"
    type: soft
    item: nofile
    value: "65536"`,
  ],
  notes: "≠ Ansible `pam_limits`: comment-as-key not supported; matches the exact `domain type item value` line (or the first matching `domain type item ` prefix when `use_first_match`).",
};

(pamLimitsModule as Module & { meta: ModuleSummary }).meta = meta;
export default pamLimitsModule;
