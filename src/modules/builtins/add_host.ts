// Built-in module: `add_host` — Ansible `add_host` alternate (in-memory inventory).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";

/** @summary Add a host (and groups) to the in-memory inventory at runtime (Ansible `add_host` alternate). Returns the host spec in `data.add_host`; capture with `register:`. Dynamic live-inventory mutation is scaffolded in RoleCall. @param ctx ModuleContext carrying `name`/`hostname`, `groups`, and any host vars. @returns ModuleResult with the host spec in `data`. */
export const addHostModule: Module = {
  name: "add_host",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const name = String(ctx.args["name"] ?? ctx.args["hostname"] ?? "");
    if (!name) return { changed: false, failed: true, msg: "add_host: 'name' (or 'hostname') is required" };
    const groups = typeof ctx.args["groups"] === "string" ? String(ctx.args["groups"]) : "";
    const hostVars: Record<string, unknown> = { ...ctx.args };
    delete hostVars["name"];
    delete hostVars["hostname"];
    delete hostVars["groups"];
    delete hostVars["_check"];
    delete hostVars["check"];
    const groupList = groups.split(",").map((g) => g.trim()).filter(Boolean);
    ctx.addHost?.(name, groupList, hostVars);
    return {
      changed: false,
      data: { add_host: { name, groups: groupList, host_vars: hostVars } },
      msg: `add_host ${name} (groups: ${groups || "none"})`,
    };
  },
};

/** Search metadata for the `add_host` module. */
export const meta: ModuleSummary = {
  name: "add_host",
  description: "Add a host (and groups) to the in-memory inventory at runtime (Ansible `add_host` alternate). The spec is returned in `data.add_host`; capture with `register:`.",
  source: "builtin",
  args: {
    name: { type: "string", required: true, description: "Hostname to add." },
    groups: { type: "string", required: false, description: "Comma-separated groups." },
  },
  examples: [
    `- add_host:
    name: "{{ item }}"
    groups: webservers
  loop:
    $each:
      $var: vars.new_hosts`,
  ],
  notes: "Registers the host into the run-level dynamic inventory (`ExecOptions.dynamicHosts`) and into the resolved host set so subsequent `hosts: all` tasks target it within the same run; the spec is also returned in `data.add_host` for `register:`. For SSH transports the host's connection vars (ansible_host, etc.) must be supplied so the transport can connect.",
};

(addHostModule as Module & { meta: ModuleSummary }).meta = meta;
export default addHostModule;
