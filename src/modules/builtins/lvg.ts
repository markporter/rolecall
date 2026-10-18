// Built-in module: `lvg` — Ansible `lvg` alternate (LVM volume group).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** @summary Create or remove an LVM volume group (Ansible `lvg` alternate). @param ctx ModuleContext carrying `vg`, `pvs`, `state`, `force`. @returns ModuleResult; `skipped` when unchanged. */
export const lvgModule: Module = {
  name: "lvg",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const a = ctx.args;
    const vg = typeof a["vg"] === "string" ? String(a["vg"]) : "";
    if (!vg) return { changed: false, failed: true, msg: "lvg: 'vg' required" };
    const state = (typeof a["state"] === "string" ? String(a["state"]) : "present") as "present" | "absent";
    const force = a["force"] === undefined ? true : Boolean(a["force"]);
    const exists = (await ctx.connection.exec(`vgs ${shQuote(vg)} >/dev/null 2>&1`)).exitCode === 0;

    if (state === "absent") {
      if (!exists) return { changed: false, skipped: true, msg: `lvg: ${vg} absent` };
      const cmd = `vgremove ${force ? "-f " : ""}${shQuote(vg)}`;
      const run = ctx.become ? `sudo sh -c ${shQuote(cmd)}` : cmd;
      const res = await ctx.connection.exec(run);
      if (res.exitCode !== 0) return { changed: false, failed: true, msg: `lvg: failed: ${res.stderr}` };
      return { changed: true, msg: `lvg: removed ${vg}` };
    }

    if (exists) return { changed: false, skipped: true, msg: `lvg: ${vg} exists` };
    const pvs = Array.isArray(a["pvs"]) ? (a["pvs"] as unknown[]).map(String) : typeof a["pvs"] === "string" ? String(a["pvs"]).split(/\s+/) : [];
    if (pvs.length === 0) return { changed: false, failed: true, msg: "lvg: 'pvs' (physical volumes) required to create" };
    const cmd = `vgcreate ${force ? "--force " : ""}${shQuote(vg)} ${pvs.map(shQuote).join(" ")}`;
    const run = ctx.become ? `sudo sh -c ${shQuote(cmd)}` : cmd;
    const res = await ctx.connection.exec(run);
    if (res.exitCode !== 0) return { changed: false, failed: true, msg: `lvg: failed: ${res.stderr}` };
    return { changed: true, msg: `lvg: created ${vg}`, data: { vg, pvs } };
  },
};

/** Search metadata for the `lvg` module. */
export const meta: ModuleSummary = {
  name: "lvg",
  description: "Create or remove an LVM volume group (Ansible `lvg` alternate). Uses `vgcreate`/`vgremove`; `force` enables `vgremove -f` / `vgcreate --force`.",
  source: "builtin",
  args: {
    vg: { type: "string", required: true, description: "Volume group name." },
    pvs: { type: "string | string[]", required: false, description: "Physical volumes (required to create)." },
    state: { type: "present | absent", required: false, description: "present (default)." },
    force: { type: "boolean", required: false, description: "Force the operation: `vgremove -f` on removal and `vgcreate --force` on creation. Defaults to true for removal (matching prior behaviour); set false to require a clean volume group." },
  },
  examples: [
    `- lvg:
    vg: vg0
    pvs: /dev/sdb1`,
  ],
  notes: "≠ Ansible `lvg`: no `pv_options` or `state: active` control; pvs passed verbatim to `vgcreate`. `force` maps to `vgremove -f` / `vgcreate --force` (default true for removal).",
};

(lvgModule as Module & { meta: ModuleSummary }).meta = meta;
export default lvgModule;
