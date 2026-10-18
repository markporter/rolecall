// Built-in module: `hostname` — Ansible `hostname` alternate (set the system hostname).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** @summary Set the target hostname (Ansible `hostname` alternate). Uses `hostnamectl set-hostname` on systemd, else writes /etc/hostname. @param ctx ModuleContext carrying `name`. @returns ModuleResult; `skipped` when unchanged. */
export const hostnameModule: Module = {
  name: "hostname",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const name = typeof ctx.args["name"] === "string" ? String(ctx.args["name"]) : "";
    if (!name) return { changed: false, failed: true, msg: "hostname: 'name' is required" };
    const cur = await ctx.connection.exec(`hostname 2>/dev/null || cat /etc/hostname 2>/dev/null`);
    const current = (cur.stdout ?? "").trim().split("\n")[0] ?? "";
    if (current === name) return { changed: false, skipped: true, msg: `hostname: already ${name}` };

    const hasSystemd = (await ctx.connection.exec(`command -v hostnamectl`)).exitCode === 0;
    const setCmd = hasSystemd
      ? `hostnamectl set-hostname ${shQuote(name)}`
      : `hostname ${shQuote(name)} && sh -c 'echo ${shQuote(name)} > /etc/hostname'`;
    const run = ctx.become ? `sudo sh -c ${shQuote(setCmd)}` : setCmd;
    const res = await ctx.connection.exec(run);
    if (res.exitCode !== 0) return { changed: false, failed: true, msg: `hostname: failed: ${res.stderr || `exit ${res.exitCode}`}` };
    return { changed: true, msg: `hostname: -> ${name}` };
  },
};

/** Search metadata for the `hostname` module. */
export const meta: ModuleSummary = {
  name: "hostname",
  description: "Set the target hostname (Ansible `hostname` alternate). Uses `hostnamectl set-hostname` on systemd, else writes /etc/hostname.",
  source: "builtin",
  args: {
    name: { type: "string", required: true, description: "Desired hostname." },
  },
  examples: [
    `- hostname:
    name: web-01`,
  ],
  notes: "≠ Ansible `hostname`: no `use` (systemd/network/non-OS) selection — picks systemd when available; no /etc/hosts update (edit that file via `copy`/`blockinfile`).",
};

(hostnameModule as Module & { meta: ModuleSummary }).meta = meta;
export default hostnameModule;
