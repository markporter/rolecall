// Built-in module: `firewalld` — manage a service, port, or rich rule through
// `firewall-cmd`.
//
// Exactly one of `service`, `port`, or `rich_rule` must be supplied. The module
// probes the current rule with `--query-<kind>` and only acts when the observed
// state differs from `state`. `permanent` writes the persistent configuration
// (`--permanent`) and `immediate` updates the running configuration (no flag);
// when both are true they run as two separate invocations.

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

const MODULE_NAME = "firewalld";

/** Rule kind selected by exactly one of service/port/rich_rule. */
type RuleKind = "service" | "port" | "rich-rule";

/** @summary Arguments for the `firewalld` module. @property service Service name to open/close. @property port Port or port range (e.g. `8080/tcp`). @property rich_rule firewalld rich-rule expression. @property zone Firewall zone (default `public`). @property permanent Write the persistent config (default true). @property immediate Update the running config (default true). @property state Desired state: `present` (default) or `absent`. */
export interface FirewalldArgs {
  /** Service name, e.g. "http". Mutually exclusive with port/rich_rule. */
  service?: string;
  /** Port or port range, e.g. "8080/tcp". Mutually exclusive with service/rich_rule. */
  port?: string;
  /** firewalld rich-rule expression. Mutually exclusive with service/port. */
  rich_rule?: string;
  /** Firewall zone (default "public"). */
  zone?: string;
  /** Write the persistent configuration (default true). */
  permanent?: boolean;
  /** Update the running configuration (default true). */
  immediate?: boolean;
  /** Desired state (default "present"). */
  state?: "present" | "absent";
}

/** Search metadata for the `firewalld` module (auto-collected by builtins/index.ts). */
export const meta: ModuleSummary = {
  name: MODULE_NAME,
  description:
    "Open or close a firewalld service, port, or rich rule idempotently in a zone, with separate persistent and runtime application.",
  idempotent: true,
  source: "builtin",
  args: {
    service: { type: "string", required: false, description: "Service name, e.g. http." },
    port: { type: "string", required: false, description: "Port or port range, e.g. 8080/tcp." },
    rich_rule: { type: "string", required: false, description: "firewalld rich-rule expression." },
    zone: { type: "string", required: false, description: "Firewall zone (default public)." },
    permanent: { type: "boolean", required: false, description: "Write the persistent config (default true)." },
    immediate: { type: "boolean", required: false, description: "Update the running config (default true)." },
    state: { type: "present | absent", required: false, description: "Desired state (default present)." },
  },
  examples: [
    `- firewalld:
    service: http
    zone: public
    state: present`,
    `- firewalld:
    port: 8080/tcp
    permanent: true
    immediate: true`,
    `- firewalld:
    rich_rule: rule family=ipv4 source address=10.0.0.0/8 accept
    zone: trusted
    state: present`,
    `- firewalld:
    service: telnet
    state: absent`,
  ],
  notes:
    "≠ Ansible `firewalld`: requires exactly one of `service`, `port`, or `rich_rule`. `permanent` and `immediate` are applied as separate `firewall-cmd` invocations when both are true. The idempotency probe queries the running configuration (no `--permanent`).",
};

/** Validate string-typed optional args so a non-string value is rejected instead of ignored. */
function stringArg(args: FirewalldArgs, field: keyof FirewalldArgs): { value: string } | { error: string } {
  const raw = args[field];
  if (raw === undefined || raw === null) return { value: "" };
  if (typeof raw !== "string") return { error: `firewalld: '${field}' must be a string` };
  return { value: raw.trim() };
}

/** @summary Idempotently manage a firewalld service, port, or rich rule. @param ctx ModuleContext carrying the rule selector, zone, permanent/immediate flags, and state. @returns ModuleResult; `changed:false` when the probe already matches the desired state. */
export const firewalldModule: Module = {
  name: MODULE_NAME,
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const args = ctx.args as unknown as FirewalldArgs;

    const serviceArg = stringArg(args, "service");
    if ("error" in serviceArg) return { changed: false, failed: true, msg: serviceArg.error };
    const portArg = stringArg(args, "port");
    if ("error" in portArg) return { changed: false, failed: true, msg: portArg.error };
    const richArg = stringArg(args, "rich_rule");
    if ("error" in richArg) return { changed: false, failed: true, msg: richArg.error };
    const zoneArg = stringArg(args, "zone");
    if ("error" in zoneArg) return { changed: false, failed: true, msg: zoneArg.error };

    const selected: Array<{ kind: RuleKind; value: string }> = [];
    if (serviceArg.value) selected.push({ kind: "service", value: serviceArg.value });
    if (portArg.value) selected.push({ kind: "port", value: portArg.value });
    if (richArg.value) selected.push({ kind: "rich-rule", value: richArg.value });
    if (selected.length !== 1) {
      return {
        changed: false,
        failed: true,
        msg: `firewalld: supply exactly one of 'service', 'port', or 'rich_rule' (got ${selected.length})`,
      };
    }

    const state = args.state ?? "present";
    if (state !== "present" && state !== "absent") {
      return {
        changed: false,
        failed: true,
        msg: `firewalld: invalid state '${String(args.state)}'; expected present or absent`,
      };
    }
    const permanent = args.permanent !== false;
    const immediate = args.immediate !== false;
    if (!permanent && !immediate) {
      return {
        changed: false,
        failed: true,
        msg: "firewalld: at least one of 'permanent' or 'immediate' must be true",
      };
    }

    const zone = zoneArg.value || "public";
    const { kind, value } = selected[0]!;
    const valueArg = kind === "rich-rule" ? shQuote(value) : value;
    const sudo = ctx.become ? "sudo " : "";
    const data = {
      service: serviceArg.value || null,
      port: portArg.value || null,
      rich_rule: richArg.value || null,
      zone,
      permanent,
      immediate,
      state,
    };

    const query = `${sudo}firewall-cmd --zone=${zone} --query-${kind}=${valueArg}`;
    const exists = (await ctx.connection.exec(query)).exitCode === 0;
    const wantPresent = state === "present";
    if (exists === wantPresent) {
      return { changed: false, msg: `firewalld: ${kind} ${value} already ${state} in ${zone}`, data: { ...data, idempotent: true } };
    }

    const action = wantPresent ? "add" : "remove";
    const targets: string[] = [];
    if (permanent) targets.push(`${sudo}firewall-cmd --zone=${zone} --${action}-${kind}=${valueArg} --permanent`);
    if (immediate) targets.push(`${sudo}firewall-cmd --zone=${zone} --${action}-${kind}=${valueArg}`);

    for (const cmd of targets) {
      const res = await ctx.connection.exec(cmd);
      if (res.exitCode !== 0) {
        return {
          changed: false,
          failed: true,
          msg: `firewalld: failed to ${action} ${kind} ${value}: ${res.stderr || `exit ${res.exitCode}`}`,
          data,
        };
      }
    }

    return {
      changed: true,
      msg: `firewalld: ${kind} ${value} ${wantPresent ? "added" : "removed"} in ${zone}`,
      data,
    };
  },
};

(firewalldModule as Module & { meta: ModuleSummary }).meta = meta;
export default firewalldModule;
