// Built-in module: `locale_gen` — Ansible `locale_gen` alternate (enable a locale).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** @summary Enable or disable a locale (Ansible `locale_gen` alternate). @param ctx ModuleContext carrying `name`, `state`. @returns ModuleResult; `skipped` when already in desired state. */
export const localeGenModule: Module = {
  name: "locale_gen",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const a = ctx.args;
    const name = typeof a["name"] === "string" ? String(a["name"]) : "";
    if (!name) return { changed: false, failed: true, msg: "locale_gen: 'name' is required" };
    const state = (typeof a["state"] === "string" ? String(a["state"]) : "present") as "present" | "absent";

    const active = (await ctx.connection.exec(`locale -a 2>/dev/null | grep -x ${shQuote(name.replace(/\./g, "").replace(/utf8/i, "UTF-8"))}`)).exitCode === 0;
    const conf = "/etc/locale.gen";
    const hasEntry = (await ctx.connection.exec(`grep -qxE '[^#]*${name}' ${conf} 2>/dev/null`)).exitCode === 0;

    if (state === "absent") {
      if (!active && !hasEntry) return { changed: false, skipped: true, msg: `locale_gen: ${name} not enabled` };
      const cmd = `sed -i "s/^${name}/${name}/" ${conf} 2>/dev/null; locale-gen`;
      const run = ctx.become ? `sudo sh -c ${shQuote(cmd)}` : cmd;
      const res = await ctx.connection.exec(run);
      if (res.exitCode !== 0) return { changed: false, failed: true, msg: `locale_gen: failed: ${res.stderr}` };
      return { changed: true, msg: `locale_gen: disabled ${name}` };
    }

    if (active && hasEntry) return { changed: false, skipped: true, msg: `locale_gen: ${name} already enabled` };
    const cmd = `sed -i "s/^# *${name}/${name}/; /^${name}/!s/^#\\( ${name}\\)/${name}/" ${conf} 2>/dev/null; grep -qxE '${name}' ${conf} 2>/dev/null || echo '${name} ${name}.utf8' >> ${conf}; locale-gen`;
    const run = ctx.become ? `sudo sh -c ${shQuote(cmd)}` : cmd;
    const res = await ctx.connection.exec(run);
    if (res.exitCode !== 0) return { changed: false, failed: true, msg: `locale_gen: failed: ${res.stderr}` };
    return { changed: true, msg: `locale_gen: enabled ${name}` };
  },
};

/** Search metadata for the `locale_gen` module. */
export const meta: ModuleSummary = {
  name: "locale_gen",
  description: "Enable or disable a locale (Ansible `locale_gen` alternate). Uncomments the entry in /etc/locale.gen and runs `locale-gen`.",
  source: "builtin",
  args: {
    name: { type: "string", required: true, description: "Locale, e.g. en_US.UTF-8." },
    state: { type: "present | absent", required: false, description: "present (default)." },
  },
  examples: [
    `- locale_gen:
    name: en_US.UTF-8
    state: present`,
  ],
  notes: "≠ Ansible `locale_gen`: only manages /etc/locale.gen + locale-gen; no separate `locale` global var file write.",
};

(localeGenModule as Module & { meta: ModuleSummary }).meta = meta;
export default localeGenModule;
