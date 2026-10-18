// Built-in module: `lvol` — Ansible `lvol` alternate (LVM logical volume).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** @summary Create or remove an LVM logical volume (Ansible `lvol` alternate). @param ctx ModuleContext carrying `vg`, `lv`, `size`, `state`, `opts`. @returns ModuleResult; `skipped` when unchanged. */
export const lvolModule: Module = {
  name: "lvol",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const a = ctx.args;
    const vg = typeof a["vg"] === "string" ? String(a["vg"]) : "";
    const lv = typeof a["lv"] === "string" ? String(a["lv"]) : "";
    if (!vg || !lv) return { changed: false, failed: true, msg: "lvol: 'vg' and 'lv' required" };
    const state = (typeof a["state"] === "string" ? String(a["state"]) : "present") as "present" | "absent";
    const path = `${vg}/${lv}`;
    const exists = (await ctx.connection.exec(`lvs ${shQuote(path)} >/dev/null 2>&1`)).exitCode === 0;

    if (state === "absent") {
      if (!exists) return { changed: false, skipped: true, msg: `lvol: ${path} absent` };
      const cmd = `lvremove -f ${shQuote(path)}`;
      const run = ctx.become ? `sudo sh -c ${shQuote(cmd)}` : cmd;
      const res = await ctx.connection.exec(run);
      if (res.exitCode !== 0) return { changed: false, failed: true, msg: `lvol: failed: ${res.stderr}` };
      return { changed: true, msg: `lvol: removed ${path}` };
    }

    if (exists) return { changed: false, skipped: true, msg: `lvol: ${path} exists` };
    const size = typeof a["size"] === "string" ? String(a["size"]) : "";
    const opts = typeof a["opts"] === "string" ? String(a["opts"]) : "";
    if (!size) return { changed: false, failed: true, msg: "lvol: 'size' required to create" };
    const cmd = `lvcreate -L ${size} -n ${shQuote(lv)} ${shQuote(vg)}${opts ? ` ${opts}` : ""}`;
    const run = ctx.become ? `sudo sh -c ${shQuote(cmd)}` : cmd;
    const res = await ctx.connection.exec(run);
    if (res.exitCode !== 0) return { changed: false, failed: true, msg: `lvol: failed: ${res.stderr}` };
    return { changed: true, msg: `lvol: created ${path} (${size})`, data: { vg, lv, size } };
  },
};

/** Search metadata for the `lvol` module. */
export const meta: ModuleSummary = {
  name: "lvol",
  description: "Create or remove an LVM logical volume (Ansible `lvol` alternate). Uses `lvcreate`/`lvremove`.",
  source: "builtin",
  args: {
    vg: { type: "string", required: true, description: "Volume group." },
    lv: { type: "string", required: true, description: "Logical volume name." },
    size: { type: "string", required: false, description: "Size, e.g. 10G or 100%FREE." },
    state: { type: "present | absent", required: false, description: "present (default)." },
  },
  examples: [
    `- lvol:
    vg: vg0
    lv: data
    size: 10G`,
  ],
  notes: "≠ Ansible `lvol`: no `thin`, `resizefs`, or `shrink` toggles; size is passed verbatim to `lvcreate -L`.",
};

(lvolModule as Module & { meta: ModuleSummary }).meta = meta;
export default lvolModule;
