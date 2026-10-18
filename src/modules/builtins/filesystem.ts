// Built-in module: `filesystem` — Ansible `filesystem` alternate (mkfs a device).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** @summary Create a filesystem on a device (Ansible `filesystem` alternate). @param ctx ModuleContext carrying `fstype`, `dev`, `force`, `opts`, `state`. @returns ModuleResult; `skipped` when already that fstype. */
export const filesystemModule: Module = {
  name: "filesystem",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const a = ctx.args;
    const fstype = typeof a["fstype"] === "string" ? String(a["fstype"]) : "";
    const dev = typeof a["dev"] === "string" ? String(a["dev"]) : "";
    if (!fstype || !dev) return { changed: false, failed: true, msg: "filesystem: 'fstype' and 'dev' required" };
    const force = Boolean(a["force"]);
    const opts = typeof a["opts"] === "string" ? String(a["opts"]) : "";

    const cur = await ctx.connection.exec(`blkid -o value -s TYPE ${shQuote(dev)} 2>/dev/null`);
    const current = (cur.stdout ?? "").trim();
    if (current === fstype) return { changed: false, skipped: true, msg: `filesystem: ${dev} already ${fstype}` };
    if (current && !force) return { changed: false, failed: true, msg: `filesystem: ${dev} has ${current}; set force to overwrite` };

    const cmd = `mkfs -t ${fstype}${opts ? ` ${opts}` : ""} ${shQuote(dev)}`;
    const run = ctx.become ? `sudo sh -c ${shQuote(cmd)}` : cmd;
    const res = await ctx.connection.exec(run);
    if (res.exitCode !== 0) return { changed: false, failed: true, msg: `filesystem: failed: ${res.stderr}` };
    return { changed: true, msg: `filesystem: ${fstype} on ${dev}`, data: { fstype, dev } };
  },
};

/** Search metadata for the `filesystem` module. */
export const meta: ModuleSummary = {
  name: "filesystem",
  description: "Create a filesystem on a device with mkfs (Ansible `filesystem` alternate). Skips when the device already has the requested fstype.",
  source: "builtin",
  args: {
    fstype: { type: "string", required: true, description: "Filesystem type, e.g. ext4/xfs." },
    dev: { type: "string", required: true, description: "Device, e.g. /dev/sdb1." },
    force: { type: "boolean", required: false, description: "Overwrite an existing filesystem." },
    opts: { type: "string", required: false, description: "Extra mkfs options." },
  },
  examples: [
    `- filesystem:
    fstype: ext4
    dev: /dev/sdb1`,
  ],
  notes: "≠ Ansible `filesystem`: `state: absent` is not supported (we never wipe a device). Destructive when `force` is set.",
};

(filesystemModule as Module & { meta: ModuleSummary }).meta = meta;
export default filesystemModule;
