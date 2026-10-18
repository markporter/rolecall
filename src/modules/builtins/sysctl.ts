// Built-in module: `sysctl` — Ansible `sysctl` alternate (set a kernel parameter).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote, wrapCommand } from "./fs";

/** @summary Set or remove a kernel parameter (Ansible `sysctl` alternate). Reads the live value from /proc/sys, applies via `sysctl -w`, and persists to /etc/sysctl.d when it differs. @param ctx ModuleContext carrying `name`, `value`, `state`, `sysctl_set`, `reload`. @returns ModuleResult; `skipped` when unchanged. */
export const sysctlModule: Module = {
  name: "sysctl",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const a = ctx.args;
    const name = typeof a["name"] === "string" ? String(a["name"]) : "";
    if (!name) return { changed: false, failed: true, msg: "sysctl: 'name' is required" };
    const state = (typeof a["state"] === "string" ? String(a["state"]) : "present") as "present" | "absent";
    const value = typeof a["value"] === "string" ? String(a["value"]) : "";
    const persist = a["sysctl_set"] !== false;
    const reload = Boolean(a["reload"] ?? true);
    const ignoreerrors = Boolean(a["ignoreerrors"]);
    const sysctlFile = typeof a["sysctl_file"] === "string" ? String(a["sysctl_file"]) : "/etc/sysctl.d/99-rolecall.conf";

    const procPath = `/proc/sys/${name.replace(/\./g, "/")}`;
    const cur = await ctx.connection.exec(`cat ${shQuote(procPath)} 2>/dev/null`);
    const current = (cur.stdout ?? "").trim();

    if (state === "absent") {
      if (!current) return { changed: false, skipped: true, msg: `sysctl: ${name} not set` };
      const rm = `sed -i.bak "/^${name.replace(/\./g, "\\.")}=/d" ${sysctlFile} 2>/dev/null; sysctl -w ${name}=`;
      const run = wrapCommand(rm, { become: Boolean(ctx.become), becomeUser: ctx.become_user, environment: ctx.environment });
      const res = await ctx.connection.exec(run);
      if (res.exitCode !== 0 && !ignoreerrors) return { changed: false, failed: true, msg: `sysctl: failed: ${res.stderr}` };
      return { changed: true, msg: `sysctl: cleared ${name}` };
    }

    if (!value) return { changed: false, failed: true, msg: "sysctl: 'value' is required when state=present" };
    if (current === value) return { changed: false, skipped: true, msg: `sysctl: ${name}=${value} unchanged` };

    const applyCmd = `sysctl -w ${name}=${value}`;
    const run = wrapCommand(applyCmd, { become: Boolean(ctx.become), becomeUser: ctx.become_user, environment: ctx.environment });
    const res = await ctx.connection.exec(run);
    if (res.exitCode !== 0 && !ignoreerrors) return { changed: false, failed: true, msg: `sysctl: failed: ${res.stderr}` };

    if (persist) {
      const conf = sysctlFile;
      const append = `mkdir -p ${shQuote(conf.replace(/[^/]+$/, ""))} && (grep -q "^${name.replace(/\./g, "\\.")}=" ${shQuote(conf)} 2>/dev/null && sed -i "s/^${name.replace(/\./g, "\\.")}=.*/${name}=${value}/" ${shQuote(conf)} || echo "${name}=${value}" >> ${shQuote(conf)})`;
      const arun = wrapCommand(append, { become: Boolean(ctx.become), becomeUser: ctx.become_user, environment: ctx.environment });
      await ctx.connection.exec(arun);
    }
    if (reload) {
      const rr = await ctx.connection.exec(wrapCommand("sysctl --system", { become: Boolean(ctx.become), becomeUser: ctx.become_user, environment: ctx.environment }));
      if (rr.exitCode !== 0 && !ignoreerrors) return { changed: false, failed: true, msg: `sysctl: reload failed: ${rr.stderr}` };
    }
    return { changed: true, msg: `sysctl: ${name}=${value}`, data: { name, value, previous: current } };
  },
};

/** Search metadata for the `sysctl` module. */
export const meta: ModuleSummary = {
  name: "sysctl",
  description: "Set a kernel parameter (Ansible `sysctl` alternate). Reads /proc/sys, applies via `sysctl -w`, persists to /etc/sysctl.d/99-rolecall.conf.",
  source: "builtin",
  args: {
    name: { type: "string", required: true, description: "Parameter name, e.g. net.ipv4.ip_forward." },
    value: { type: "string", required: false, description: "Value to set (required when state=present)." },
    state: { type: "present | absent", required: false, description: "present (default) or absent." },
    sysctl_file: { type: "string", required: false, description: "Persisted-file path for the setting (default /etc/sysctl.d/99-rolecall.conf)." },
    ignoreerrors: { type: "boolean", required: false, description: "Continue (do not fail the task) when `sysctl` returns a non-zero exit." },
  },
  examples: [
    `- sysctl:
    name: net.ipv4.ip_forward
    value: "1"`,
  ],
  notes: "≠ Ansible `sysctl`: persists to a single default file (override with `sysctl_file`); `ignoreerrors` continues past non-zero `sysctl` exits.",
};

(sysctlModule as Module & { meta: ModuleSummary }).meta = meta;
export default sysctlModule;
