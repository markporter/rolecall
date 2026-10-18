// Built-in module: `timezone` — Ansible `timezone` alternate (set system timezone).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** @summary Set the system timezone (Ansible `timezone` alternate). @param ctx ModuleContext carrying `name`. @returns ModuleResult; `skipped` when unchanged. */
export const timezoneModule: Module = {
  name: "timezone",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const name = typeof ctx.args["name"] === "string" ? String(ctx.args["name"]) : "";
    if (!name) return { changed: false, failed: true, msg: "timezone: 'name' is required" };
    const cur = await ctx.connection.exec(`timedatectl show --property=Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null`);
    const current = (cur.stdout ?? "").trim();
    if (current === name) return { changed: false, skipped: true, msg: `timezone: already ${name}` };

    const hasTdctl = (await ctx.connection.exec(`command -v timedatectl`)).exitCode === 0;
    const cmd = hasTdctl
      ? `timedatectl set-timezone ${shQuote(name)}`
      : `ln -sf ${shQuote(`/usr/share/zoneinfo/${name}`)} /etc/localtime && dpkg-reconfigure -f noninteractive tzdata 2>/dev/null || true`;
    const run = ctx.become ? `sudo sh -c ${shQuote(cmd)}` : cmd;
    const res = await ctx.connection.exec(run);
    if (res.exitCode !== 0) return { changed: false, failed: true, msg: `timezone: failed: ${res.stderr}` };
    return { changed: true, msg: `timezone: -> ${name}` };
  },
};

/** Search metadata for the `timezone` module. */
export const meta: ModuleSummary = {
  name: "timezone",
  description: "Set the system timezone (Ansible `timezone` alternate). Uses `timedatectl set-timezone` when available.",
  source: "builtin",
  args: {
    name: { type: "string", required: true, description: "Timezone, e.g. UTC or Europe/London." },
  },
  examples: [
    `- timezone:
    name: UTC`,
  ],
  notes: "≠ Ansible `timezone`: no `hwclock` sync toggle; only sets the OS timezone.",
};

(timezoneModule as Module & { meta: ModuleSummary }).meta = meta;
export default timezoneModule;
