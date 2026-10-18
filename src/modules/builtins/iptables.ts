// Built-in module: `iptables` — Ansible `iptables` alternate (manage a rule).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** @summary Manage an iptables rule (Ansible `iptables` alternate). Builds a -C/-A/-I/-D rule from chain/table/protocol/port/jump. @param ctx ModuleContext carrying `chain`, `table`, `protocol`, `destination_port`, `jump`, `state`, `action`, `comment`. @returns ModuleResult; `skipped` when present/absent already matches. */
export const iptablesModule: Module = {
  name: "iptables",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const a = ctx.args;
    const chain = typeof a["chain"] === "string" ? String(a["chain"]) : "INPUT";
    const table = typeof a["table"] === "string" ? String(a["table"]) : "filter";
    const proto = typeof a["protocol"] === "string" ? String(a["protocol"]) : "";
    const dport = typeof a["destination_port"] === "string" ? String(a["destination_port"]) : "";
    const jump = typeof a["jump"] === "string" ? String(a["jump"]) : "ACCEPT";
    const state = (typeof a["state"] === "string" ? String(a["state"]) : "present") as "present" | "absent";
    const action = (typeof a["action"] === "string" ? String(a["action"]) : "append") as "append" | "insert";
    const comment = typeof a["comment"] === "string" ? String(a["comment"]) : "";

    let match = "";
    if (proto) match += ` -p ${proto}`;
    if (dport) match += ` --dport ${dport}`;
    if (comment) match += ` -m comment --comment ${shQuote(comment)}`;
    const rule = `-t ${table} ${chain}${match} -j ${jump}`;
    const check = `iptables -C ${rule}`;
    const present = (await ctx.connection.exec(check)).exitCode === 0;

    if (state === "absent") {
      if (!present) return { changed: false, skipped: true, msg: `iptables: rule absent already` };
      const cmd = `iptables -D ${rule}`;
      const run = ctx.become ? `sudo sh -c ${shQuote(cmd)}` : cmd;
      const res = await ctx.connection.exec(run);
      if (res.exitCode !== 0) return { changed: false, failed: true, msg: `iptables: failed: ${res.stderr}` };
      return { changed: true, msg: `iptables: removed rule` };
    }
    if (present) return { changed: false, skipped: true, msg: `iptables: rule present already` };
    const addFlag = action === "insert" ? "-I" : "-A";
    const cmd = `iptables ${addFlag} ${rule}`;
    const run = ctx.become ? `sudo sh -c ${shQuote(cmd)}` : cmd;
    const res = await ctx.connection.exec(run);
    if (res.exitCode !== 0) return { changed: false, failed: true, msg: `iptables: failed: ${res.stderr}` };
    return { changed: true, msg: `iptables: added rule (${action})`, data: { chain, table, jump } };
  },
};

/** Search metadata for the `iptables` module. */
export const meta: ModuleSummary = {
  name: "iptables",
  description: "Manage an iptables rule (Ansible `iptables` alternate). Checks via -C, adds via -A/-I, removes via -D.",
  source: "builtin",
  args: {
    chain: { type: "string", required: false, description: "Chain (default INPUT)." },
    table: { type: "string", required: false, description: "Table (default filter)." },
    protocol: { type: "string", required: false, description: "Protocol, e.g. tcp." },
    destination_port: { type: "string", required: false, description: "Destination port." },
    jump: { type: "string", required: false, description: "Target, e.g. ACCEPT/DROP (default ACCEPT)." },
    state: { type: "present | absent", required: false, description: "present (default)." },
  },
  examples: [
    `- iptables:
    chain: INPUT
    protocol: tcp
    destination_port: "8080"
    jump: ACCEPT`,
  ],
  notes: "≠ Ansible `iptables`: no automatic `iptables-save` persistence; add a `shell` task to persist rules. No match/source rich args (protocol/port/jump only).",
};

(iptablesModule as Module & { meta: ModuleSummary }).meta = meta;
export default iptablesModule;
