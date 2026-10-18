// Built-in module: `parted` — Ansible `parted` alternate (create/remove a partition).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** @summary Create or remove a partition with parted (Ansible `parted` alternate). @param ctx ModuleContext carrying `device`, `number`, `part_type`, `part_start`, `part_end`, `flags`, `state`, `label`. @returns ModuleResult; `skipped` when unchanged. */
export const partedModule: Module = {
  name: "parted",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const a = ctx.args;
    const device = typeof a["device"] === "string" ? String(a["device"]) : "";
    if (!device) return { changed: false, failed: true, msg: "parted: 'device' required" };
    const number = a["number"] != null ? Number(a["number"]) : 1;
    const state = (typeof a["state"] === "string" ? String(a["state"]) : "present") as "present" | "absent";
    const label = typeof a["label"] === "string" ? String(a["label"]) : "gpt";

    const exists = (await ctx.connection.exec(`parted -m ${shQuote(device)} print 2>/dev/null | awk -F: -v n=${number} '$1==n{print $1}'`)).exitCode === 0;

    if (state === "absent") {
      if (!exists) return { changed: false, skipped: true, msg: `parted: partition ${number} absent` };
      const cmd = `parted -s ${shQuote(device)} rm ${number}`;
      const run = ctx.become ? `sudo sh -c ${shQuote(cmd)}` : cmd;
      const res = await ctx.connection.exec(run);
      if (res.exitCode !== 0) return { changed: false, failed: true, msg: `parted: failed: ${res.stderr}` };
      return { changed: true, msg: `parted: removed ${number}` };
    }

    const partType = typeof a["part_type"] === "string" ? String(a["part_type"]) : "primary";
    const start = typeof a["part_start"] === "string" ? String(a["part_start"]) : "0%";
    const end = typeof a["part_end"] === "string" ? String(a["part_end"]) : "100%";
    const flags = Array.isArray(a["flags"]) ? (a["flags"] as unknown[]).map(String) : typeof a["flags"] === "string" ? String(a["flags"]).split(",") : [];

    let script = "";
    if (!exists) script += `mklabel ${label}; `;
    script += `mkpart ${partType} ${start} ${end}; `;
    for (const f of flags) script += `set ${number} ${f} on; `;
    const cmd = `parted -s ${shQuote(device)} ${script}`;
    const run = ctx.become ? `sudo sh -c ${shQuote(cmd)}` : cmd;
    const res = await ctx.connection.exec(run);
    if (res.exitCode !== 0) return { changed: false, failed: true, msg: `parted: failed: ${res.stderr}` };
    return { changed: true, msg: `parted: ${device} p${number} (${start}-${end})`, data: { device, number, partType } };
  },
};

/** Search metadata for the `parted` module. */
export const meta: ModuleSummary = {
  name: "parted",
  description: "Create or remove a partition with parted (Ansible `parted` alternate). Creates the label if missing, then mkpart + flags.",
  source: "builtin",
  args: {
    device: { type: "string", required: true, description: "Disk device, e.g. /dev/sdb." },
    number: { type: "number", required: false, description: "Partition number (default 1)." },
    part_type: { type: "primary | logical | extended", required: false, description: "Partition type (default primary)." },
    part_start: { type: "string", required: false, description: "Start (default 0%)." },
    part_end: { type: "string", required: false, description: "End (default 100%)." },
    flags: { type: "string | string[]", required: false, description: "Flags to set on, e.g. lvm." },
    state: { type: "present | absent", required: false, description: "present (default)." },
    label: { type: "msdos | gpt", required: false, description: "Disk label (default gpt)." },
  },
  examples: [
    `- parted:
    device: /dev/sdb
    number: 1
    part_start: 0%
    part_end: 100%
    flags: lvm`,
  ],
  notes: "≠ Ansible `parted`: no `align`/`unit` control; label auto-created when the disk is unlabeled. Destructive — review before running.",
};

(partedModule as Module & { meta: ModuleSummary }).meta = meta;
export default partedModule;
