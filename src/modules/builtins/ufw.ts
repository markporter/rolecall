// Built-in module: `ufw` — Ansible `ufw` alternate (Uncomplicated Firewall).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** @summary Manage UFW firewall rules/state (Ansible `ufw` alternate). @param ctx ModuleContext carrying `rule`, `port`, `proto`, `direction`, `state`, `from_ip`, `to_ip`, `interface`, `log`. @returns ModuleResult. */
export const ufwModule: Module = {
  name: "ufw",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const a = ctx.args;
    const state = typeof a["state"] === "string" ? String(a["state"]) : "";
    if (state === "enabled" || state === "disabled") {
      const cmd = `ufw --force ${state}`;
      const run = ctx.become ? `sudo sh -c ${shQuote(cmd)}` : cmd;
      const res = await ctx.connection.exec(run);
      if (res.exitCode !== 0) return { changed: false, failed: true, msg: `ufw: failed: ${res.stderr}` };
      return { changed: true, msg: `ufw: ${state}` };
    }

    const rule = typeof a["rule"] === "string" ? String(a["rule"]) : "allow";
    const port = typeof a["port"] === "string" ? String(a["port"]) : "";
    const proto = typeof a["proto"] === "string" ? String(a["proto"]) : "";
    const direction = typeof a["direction"] === "string" ? String(a["direction"]) : "";
    const fromIp = typeof a["from_ip"] === "string" ? String(a["from_ip"]) : "";
    const toIp = typeof a["to_ip"] === "string" ? String(a["to_ip"]) : "";
    const iface = typeof a["interface"] === "string" ? String(a["interface"]) : "";
    const log = a["log"] === true;

    let spec = rule;
    if (direction) spec += ` ${direction}`;
    if (iface) spec += ` on ${iface}`;
    if (fromIp) spec += ` from ${fromIp}`;
    if (toIp) spec += ` to ${toIp}`;
    if (port) spec += ` ${port}${proto ? `/${proto}` : ""}`;
    else if (proto) spec += ` proto ${proto}`;
    if (log) spec += " log";

    const cmd = `ufw ${spec}`;
    const run = ctx.become ? `sudo sh -c ${shQuote(cmd)}` : cmd;
    const res = await ctx.connection.exec(run);
    if (res.exitCode !== 0) return { changed: false, failed: true, msg: `ufw: failed: ${res.stderr}` };
    return { changed: true, msg: `ufw: ${spec}`, data: { rule, port, proto } };
  },
};

/** Search metadata for the `ufw` module. */
export const meta: ModuleSummary = {
  name: "ufw",
  description: "Manage UFW firewall rules and enable/disable (Ansible `ufw` alternate).",
  source: "builtin",
  args: {
    rule: { type: "allow | deny | limit | reject", required: false, description: "Action (default allow)." },
    port: { type: "string", required: false, description: "Port or port range." },
    proto: { type: "tcp | udp", required: false, description: "Protocol." },
    state: { type: "enabled | disabled", required: false, description: "Enable/disable the firewall." },
    direction: { type: "in | out", required: false, description: "Rule direction." },
  },
  examples: [
    `- ufw:
    rule: allow
    port: "22"
    proto: tcp`,
    `- ufw:
    state: enabled`,
  ],
  notes: "≠ Ansible `ufw`: `ufw allow` is naturally idempotent on the host; no `default` policy arg (set via a `shell` task).",
};

(ufwModule as Module & { meta: ModuleSummary }).meta = meta;
export default ufwModule;
