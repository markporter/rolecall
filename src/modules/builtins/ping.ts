// Liveness module used by the serve orchestrator's adhoc/playbook runs.
//
// Pings the target through its Connection.health() probe, so it works uniformly
// across SSH/local/HTTP/network-simulator transports without issuing a mutating
// command. Check mode is intrinsically read-only.

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";

export const meta: ModuleSummary = {
  name: "ping",
  description: "Probe target reachability through the connection's health check (never mutates state).",
  idempotent: true,
  source: "builtin",
  args: {},
  examples: [
    `- name: Probe target liveness
  module: ping`,
  ],
  notes: "Read-only liveness probe used by serve-mode adhoc jobs; reports latency when the transport exposes it.",
};

export const pingModule: Module = {
  name: "ping",
  supportsCheck: true,
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const health = await ctx.connection.health();
    if (!health.ok) {
      return { changed: false, failed: true, msg: health.error ?? "target unreachable" };
    }
    return {
      changed: false,
      msg: "reachable",
      data: { ...(health.latencyMs !== undefined ? { latencyMs: health.latencyMs } : {}) },
    };
  },
};
