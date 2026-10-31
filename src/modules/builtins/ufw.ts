// Built-in module: `ufw` — Ansible `ufw` alternate (Uncomplicated Firewall).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { CheckableModule } from "../../idempotency";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

const UFW_POLICIES = ["allow", "deny", "reject"] as const;

/** @summary Manage UFW firewall rules/state (Ansible `ufw` alternate). @param ctx ModuleContext carrying `rule`, `port`, `proto`, `direction`, `state`, `default`, `from_ip`, `to_ip`, `interface`, `log`. @returns ModuleResult. */
export const ufwModule: Module & CheckableModule = {
  name: "ufw",
  async check(args, ctx) {
    const a = args;
    const status = await ctx.connection.exec("ufw status 2>/dev/null");
    if (status.exitCode !== 0) return { current: null, inDesired: false };
    const text = status.stdout ?? "";
    const state = typeof a["state"] === "string" ? String(a["state"]) : "";
    if (state === "enabled" || state === "disabled") {
      const active = /^Status:\s*active/im.test(text);
      return { current: { active }, inDesired: state === "enabled" ? active : !active };
    }
    const policyArg = a["default"];
    const policy = policyArg === undefined || policyArg === null ? "" : String(policyArg);
    if (policy) {
      const verbose = await ctx.connection.exec("ufw status verbose 2>/dev/null");
      const current = (verbose.stdout ?? text).match(/^Default:\s*(\w+)\s*\(incoming\)/im)?.[1] ?? "";
      return { current, inDesired: current === policy };
    }
    const rule = typeof a["rule"] === "string" ? String(a["rule"]) : "allow";
    const port = typeof a["port"] === "string" ? String(a["port"]) : "";
    const proto = typeof a["proto"] === "string" ? String(a["proto"]) : "";
    const fromIp = typeof a["from_ip"] === "string" ? String(a["from_ip"]) : "";
    const toIp = typeof a["to_ip"] === "string" ? String(a["to_ip"]) : "";
    const iface = typeof a["interface"] === "string" ? String(a["interface"]) : "";
    const needles: string[] = [];
    if (port) needles.push(proto ? `${port}/${proto}` : port);
    else if (proto) needles.push(proto);
    if (fromIp) needles.push(fromIp);
    if (toIp) needles.push(toIp);
    if (iface) needles.push(iface);
    if (needles.length === 0) return { current: text, inDesired: false };
    const action = rule.toUpperCase();
    const present = text.split("\n").some((line) => {
      const l = line.toLowerCase();
      return l.includes(action.toLowerCase()) && needles.every((n) => l.includes(n.toLowerCase()));
    });
    return { current: text, inDesired: present };
  },
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const a = ctx.args;

    const policyArg = a["default"];
    const policy = policyArg === undefined || policyArg === null ? "" : String(policyArg);
    if (policy && !(UFW_POLICIES as readonly string[]).includes(policy)) {
      return {
        changed: false,
        failed: true,
        msg: `ufw: invalid 'default' ${JSON.stringify(policy)}; expected one of ${UFW_POLICIES.join(", ")}`,
      };
    }

    const state = typeof a["state"] === "string" ? String(a["state"]) : "";
    if (state === "enabled" || state === "disabled") {
      const cmd = `ufw --force ${state}`;
      const run = ctx.become ? `sudo sh -c ${shQuote(cmd)}` : cmd;
      const res = await ctx.connection.exec(run);
      if (res.exitCode !== 0) return { changed: false, failed: true, msg: `ufw: failed: ${res.stderr}` };
      return { changed: true, msg: `ufw: ${state}` };
    }

    if (policy) {
      const cmd = `ufw default ${policy} incoming`;
      const run = ctx.become ? `sudo sh -c ${shQuote(cmd)}` : cmd;
      const res = await ctx.connection.exec(run);
      if (res.exitCode !== 0) return { changed: false, failed: true, msg: `ufw: failed: ${res.stderr}` };
      return { changed: true, msg: `ufw: default ${policy} incoming` };
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
    rule: { type: "allow | deny | limit | reject", required: false, description: "Action for a rule (default allow)." },
    port: { type: "string", required: false, description: "Port or port range." },
    proto: { type: "tcp | udp", required: false, description: "Protocol." },
    state: { type: "enabled | disabled", required: false, description: "Enable/disable the firewall." },
    direction: { type: "in | out", required: false, description: "Rule direction." },
    default: { type: "allow | deny | reject", required: false, description: "Set the default incoming policy (`ufw default <policy> incoming`)." },
    from_ip: { type: "string", required: false, description: "Source IP/network to match (`from <from_ip>`)." },
    to_ip: { type: "string", required: false, description: "Destination IP/network to match (`to <to_ip>`)." },
    interface: { type: "string", required: false, description: "Restrict a rule to an interface (`on <interface>`)." },
    log: { type: "boolean", required: false, description: "Log packets matching the rule (appends `log`)." },
  },
  examples: [
    `- ufw:
    rule: allow
    port: "22"
    proto: tcp`,
    `- ufw:
    state: enabled`,
    `- ufw:
    default: deny`,
  ],
  notes: "≠ Ansible `ufw`: `ufw allow` is naturally idempotent on the host; the default incoming policy is set with `default: <allow|deny|reject>` (`ufw default <policy> incoming`).",
};

(ufwModule as Module & { meta: ModuleSummary }).meta = meta;
export default ufwModule;
