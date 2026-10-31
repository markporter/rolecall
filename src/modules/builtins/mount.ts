// Built-in module: `mount` — Ansible `mount` alternate (mount/unmount a filesystem).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { CheckableModule } from "../../idempotency";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** @summary Mount or unmount a filesystem (Ansible `mount` alternate). Uses `mount`/`umount` and optionally persists to /etc/fstab. @param ctx ModuleContext carrying `path`, `src`, `fstype`, `opts`, `state`, `fstab`, `boot`, `dump`, `passno`. @returns ModuleResult; `skipped` when already in desired state. */
export const mountModule: Module & CheckableModule = {
  name: "mount",
  async check(args, ctx) {
    const path = typeof args["path"] === "string" ? String(args["path"]) : "";
    const state = (typeof args["state"] === "string" ? String(args["state"]) : "mounted") as "mounted" | "unmounted" | "absent" | "present";
    const isMounted = (await ctx.connection.exec(`findmnt -n -o TARGET ${shQuote(path)} 2>/dev/null`)).exitCode === 0;
    return { current: { mounted: isMounted }, inDesired: state === "unmounted" || state === "absent" ? !isMounted : isMounted };
  },
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const a = ctx.args;
    const path = typeof a["path"] === "string" ? String(a["path"]) : "";
    if (!path) return { changed: false, failed: true, msg: "mount: 'path' (mount point) is required" };
    const state = (typeof a["state"] === "string" ? String(a["state"]) : "mounted") as "mounted" | "unmounted" | "absent" | "present";
    const src = typeof a["src"] === "string" ? String(a["src"]) : "";
    const fstype = typeof a["fstype"] === "string" ? String(a["fstype"]) : "";
    const opts = typeof a["opts"] === "string" ? String(a["opts"]) : "defaults";
    const boot = a["boot"] !== false;
    const dump = typeof a["dump"] === "number" || typeof a["dump"] === "string" ? String(a["dump"]) : "0";
    const passno = typeof a["passno"] === "number" || typeof a["passno"] === "string" ? String(a["passno"]) : "0";
    const doFstab = boot && a["fstab"] !== false;

    const isMounted = (await ctx.connection.exec(`findmnt -n -o TARGET ${shQuote(path)} 2>/dev/null`)).exitCode === 0;

    if (state === "unmounted" || state === "absent") {
      if (!isMounted) return { changed: false, skipped: true, msg: `mount: ${path} not mounted` };
      const um = `umount ${shQuote(path)}`;
      const run = ctx.become ? `sudo sh -c ${shQuote(um)}` : um;
      const res = await ctx.connection.exec(run);
      if (res.exitCode !== 0) return { changed: false, failed: true, msg: `mount: umount failed: ${res.stderr}` };
      if (doFstab && state === "absent") {
        const clr = `sed -i.bak "\\#${path}#d" /etc/fstab 2>/dev/null; true`;
        await ctx.connection.exec(ctx.become ? `sudo sh -c ${shQuote(clr)}` : clr);
      }
      return { changed: true, msg: `mount: ${path} ${state}` };
    }

    if (isMounted) return { changed: false, skipped: true, msg: `mount: ${path} already mounted` };
    if (!src || !fstype) return { changed: false, failed: true, msg: "mount: 'src' and 'fstype' required to mount" };
    const mnt = `mkdir -p ${shQuote(path)} && mount -t ${fstype} -o ${opts} ${shQuote(src)} ${shQuote(path)}`;
    const run = ctx.become ? `sudo sh -c ${shQuote(mnt)}` : mnt;
    const res = await ctx.connection.exec(run);
    if (res.exitCode !== 0) return { changed: false, failed: true, msg: `mount: failed: ${res.stderr}` };
    if (doFstab) {
      const line = `${src} ${path} ${fstype} ${opts} ${dump} ${passno}`;
      const append = `grep -q "${path}" /etc/fstab 2>/dev/null || echo "${line}" >> /etc/fstab`;
      await ctx.connection.exec(ctx.become ? `sudo sh -c ${shQuote(append)}` : append);
    }
    return { changed: true, msg: `mount: ${src} -> ${path}`, data: { path, src, fstype, opts } };
  },
};

/** Search metadata for the `mount` module. */
export const meta: ModuleSummary = {
  name: "mount",
  description: "Mount or unmount a filesystem (Ansible `mount` alternate). Uses `mount`/`umount`; optionally persists to /etc/fstab.",
  source: "builtin",
  args: {
    path: { type: "string", required: true, description: "Mount point." },
    src: { type: "string", required: false, description: "Device/source (required to mount)." },
    fstype: { type: "string", required: false, description: "Filesystem type (required to mount)." },
    opts: { type: "string", required: false, description: "Mount options (default 'defaults')." },
    state: { type: "mounted | unmounted | present | absent", required: false, description: "mounted (default), unmounted, present, or absent." },
    fstab: { type: "boolean", required: false, description: "Persist an /etc/fstab entry (default true)." },
    boot: { type: "boolean", required: false, description: "Write the /etc/fstab entry for boot-time mounting (default true)." },
    dump: { type: "number | string", required: false, description: "fstab dump field (default 0)." },
    passno: { type: "number | string", required: false, description: "fstab passno field (default 0)." },
  },
  examples: [
    `- mount:
    path: /mnt/data
    src: /dev/sdb1
    fstype: ext4
    state: mounted`,
  ],
  notes: "≠ Ansible `mount`: the /etc/fstab line is `${src} ${path} ${fstype} ${opts} ${dump} ${passno}` (defaults `0 0`); `boot: false` skips all /etc/fstab writes; idempotency is via `findmnt`.",
};

(mountModule as Module & { meta: ModuleSummary }).meta = meta;
export default mountModule;
