// Built-in module: `modprobe` — Ansible `modprobe` alternate (load/unload a kernel module).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** @summary Load or unload a kernel module (Ansible `modprobe` alternate). Loads via `modprobe` and persists to /etc/modules-load.d. @param ctx ModuleContext carrying `name`, `state`, `params`, `persistent`. @returns ModuleResult; `skipped` when already in desired state. */
export const modprobeModule: Module = {
  name: "modprobe",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const a = ctx.args;
    const name = typeof a["name"] === "string" ? String(a["name"]) : "";
    if (!name) return { changed: false, failed: true, msg: "modprobe: 'name' is required" };
    const state = (typeof a["state"] === "string" ? String(a["state"]) : "present") as "present" | "absent";
    const params = typeof a["params"] === "string" ? String(a["params"]) : "";
    const persistent = a["persistent"] !== false;

    const loaded = (await ctx.connection.exec(`lsmod | awk '{print $1}' | grep -x ${shQuote(name)}`)).exitCode === 0;

    if (state === "absent") {
      if (!loaded) return { changed: false, skipped: true, msg: `modprobe: ${name} not loaded` };
      const rm = `modprobe -r ${name}`;
      const run = ctx.become ? `sudo sh -c ${shQuote(rm)}` : rm;
      const res = await ctx.connection.exec(run);
      if (res.exitCode !== 0) return { changed: false, failed: true, msg: `modprobe: failed: ${res.stderr}` };
      if (persistent) {
        const clear = `rm -f /etc/modules-load.d/rolecall-${name}.conf`;
        await ctx.connection.exec(ctx.become ? `sudo sh -c ${shQuote(clear)}` : clear);
      }
      return { changed: true, msg: `modprobe: removed ${name}` };
    }

    if (loaded) return { changed: false, skipped: true, msg: `modprobe: ${name} already loaded` };
    const load = `modprobe ${name}${params ? ` ${params}` : ""}`;
    const run = ctx.become ? `sudo sh -c ${shQuote(load)}` : load;
    const res = await ctx.connection.exec(run);
    if (res.exitCode !== 0) return { changed: false, failed: true, msg: `modprobe: failed: ${res.stderr}` };
    if (persistent) {
      const conf = `/etc/modules-load.d/rolecall-${name}.conf`;
      const write = `mkdir -p /etc/modules-load.d && echo "${name}${params ? ` ${params}` : ""}" > ${conf}`;
      await ctx.connection.exec(ctx.become ? `sudo sh -c ${shQuote(write)}` : write);
    }
    return { changed: true, msg: `modprobe: loaded ${name}`, data: { name, params } };
  },
};

/** Search metadata for the `modprobe` module. */
export const meta: ModuleSummary = {
  name: "modprobe",
  description: "Load or unload a kernel module (Ansible `modprobe` alternate). Loads via `modprobe`; persists to /etc/modules-load.d/rolecall-<name>.conf.",
  source: "builtin",
  args: {
    name: { type: "string", required: true, description: "Module name." },
    state: { type: "present | absent", required: false, description: "present (default) or absent." },
    params: { type: "string", required: false, description: "Extra modprobe params." },
  },
  examples: [
    `- modprobe:
    name: br_netfilter
    state: present`,
  ],
  notes: "≠ Ansible `modprobe`: persists to /etc/modules-load.d/rolecall-<name>.conf (no `modprobe_options` file path arg); no blacklist handling.",
};

(modprobeModule as Module & { meta: ModuleSummary }).meta = meta;
export default modprobeModule;
