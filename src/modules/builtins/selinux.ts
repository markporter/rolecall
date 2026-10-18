// Built-in module: `selinux` — Ansible `selinux`/`seboolean` alternate (SELinux state/boolean).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** @summary Manage SELinux state or a boolean (Ansible `selinux`/`seboolean` alternate). @param ctx ModuleContext carrying `state` (enforcing/permissive/disabled) and/or `boolean`+`value`. @returns ModuleResult; `skipped` when unchanged. */
export const selinuxModule: Module = {
  name: "selinux",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const a = ctx.args;
    const state = typeof a["state"] === "string" ? String(a["state"]) : "";
    const boolName = typeof a["boolean"] === "string" ? String(a["boolean"]) : "";
    const boolVal = typeof a["value"] === "string" ? String(a["value"]) : "";
    if (!state && !boolName) return { changed: false, failed: true, msg: "selinux: provide 'state' or 'boolean'+'value'" };

    if (boolName) {
      const cur = await ctx.connection.exec(`getsebool ${shQuote(boolName)}`);
      const current = (cur.stdout ?? "").trim().split(/-->|\s+/)[1] ?? "";
      const want = boolVal === "off" ? "off" : "on";
      if (current === want) return { changed: false, skipped: true, msg: `selinux: ${boolName}=${want} unchanged` };
      const cmd = `setsebool -P ${boolName} ${want}`;
      const run = ctx.become ? `sudo sh -c ${shQuote(cmd)}` : cmd;
      const res = await ctx.connection.exec(run);
      if (res.exitCode !== 0) return { changed: false, failed: true, msg: `selinux: failed: ${res.stderr}` };
      return { changed: true, msg: `selinux: ${boolName}=${want}` };
    }

    const cur = await ctx.connection.exec(`getenforce 2>/dev/null`);
    const current = (cur.stdout ?? "").trim().toLowerCase();
    if (current === state) return { changed: false, skipped: true, msg: `selinux: already ${state}` };
    const cmd = `setenforce ${state} && sed -i 's/^SELINUX=.*/SELINUX=${state}/' /etc/selinux/config`;
    const run = ctx.become ? `sudo sh -c ${shQuote(cmd)}` : cmd;
    const res = await ctx.connection.exec(run);
    if (res.exitCode !== 0) return { changed: false, failed: true, msg: `selinux: failed: ${res.stderr}` };
    return { changed: true, msg: `selinux: -> ${state}` };
  },
};

/** Search metadata for the `selinux` module. */
export const meta: ModuleSummary = {
  name: "selinux",
  description: "Set SELinux enforcing/permissive/disabled or toggle a boolean (Ansible `selinux`/`seboolean` alternate).",
  source: "builtin",
  args: {
    state: { type: "enforcing | permissive | disabled", required: false, description: "SELinux mode to set." },
    boolean: { type: "string", required: false, description: "SELinux boolean name to toggle." },
    value: { type: "on | off", required: false, description: "Boolean value (with boolean)." },
  },
  examples: [
    `- selinux:
    state: enforcing`,
    `- selinux:
    boolean: httpd_can_network_connect
    value: on`,
  ],
  notes: "≠ Ansible `selinux`: no per-file-context (`sefcontext`) management here; only mode + booleans.",
};

(selinuxModule as Module & { meta: ModuleSummary }).meta = meta;
export default selinuxModule;
