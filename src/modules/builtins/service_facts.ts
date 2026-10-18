// Built-in module: `service_facts` — Ansible `service_facts` alternate (list units).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";

/** @summary Gather service facts on systemd targets (Ansible `service_facts` alternate). @param ctx ModuleContext. @returns ModuleResult with `data.services` keyed by unit name. */
export const serviceFactsModule: Module = {
  name: "service_facts",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const hasSystemd = (await ctx.connection.exec(`command -v systemctl`)).exitCode === 0;
    if (!hasSystemd) return { changed: false, skipped: true, msg: "service_facts: systemd not present", data: { services: {} } };
    const list = await ctx.connection.exec(`systemctl list-unit-files --type=service --no-legend --no-pager 2>/dev/null`);
    const services: Record<string, { name: string; enabled: boolean; state: string }> = {};
    for (const line of (list.stdout ?? "").split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;
      const name = parts[0] ?? "";
      services[name] = { name, enabled: parts[1] === "enabled", state: "unknown" };
    }
    const active = await ctx.connection.exec(`systemctl list-units --type=service --all --no-legend --no-pager 2>/dev/null`);
    for (const line of (active.stdout ?? "").split("\n")) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 3) continue;
      const name = cols[0] ?? "";
      if (services[name]) services[name].state = cols[2] ?? "unknown";
    }
    return { changed: false, skipped: false, msg: `service_facts: ${Object.keys(services).length} units`, data: { services } };
  },
};

/** Search metadata for the `service_facts` module. */
export const meta: ModuleSummary = {
  name: "service_facts",
  description: "Gather service units on systemd targets (Ansible `service_facts` alternate). Returns `data.services` keyed by unit name with {enabled, state}.",
  source: "builtin",
  args: {},
  examples: [
    `- service_facts: {}`,
  ],
  notes: "≠ Ansible `service_facts`: systemd-only. `state` is the active state from `systemctl list-units` (running/exited/dead/…); `enabled` from `list-unit-files`. SysV/Upstart not enumerated.",
};

(serviceFactsModule as Module & { meta: ModuleSummary }).meta = meta;
export default serviceFactsModule;
