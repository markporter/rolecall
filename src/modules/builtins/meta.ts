// Built-in module: `meta` — Ansible `meta` alternate (executor control flags; not yet wired).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";

/** @summary Request an executor control action (Ansible `meta` alternate). @param ctx ModuleContext carrying control flags. @returns ModuleResult; `noop`/`reset_connection`/`clear_facts` act immediately, while `end_play`/`end_host`/`refresh_inventory`/`end_batch`/`flush_handlers` are surfaced for the executor (engine consumption pending). */
export const metaModule: Module = {
  name: "meta",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const a = ctx.args;
    const truthy = (k: string): boolean => a[k] === true || a[k] === "true";
    const acted: string[] = [];
    if (truthy("noop")) acted.push("noop");
    if (truthy("reset_connection")) {
      await ctx.resetConnection?.();
      acted.push("reset_connection");
    }
    if (truthy("clear_facts")) {
      ctx.clearFacts?.();
      acted.push("clear_facts");
    }
    const deferred: string[] = [];
    for (const k of ["end_play", "end_host", "end_batch", "refresh_inventory", "flush_handlers"] as const) {
      if (truthy(k)) deferred.push(k);
    }
    const skipped = acted.length === 0 && deferred.length === 0;
    const halt: "play" | "host" | undefined = deferred.includes("end_play")
      ? "play"
      : deferred.includes("end_host")
        ? "host"
        : undefined;
    return {
      changed: false,
      skipped,
      msg: `meta: acted [${acted.join(", ") || "none"}] deferred [${deferred.join(", ") || "none"}]`,
      data: { meta: { acted, deferred } },
      halt,
    };
  },
};

/** Search metadata for the `meta` module. */
export const metaSummary: ModuleSummary = {
  name: "meta",
  description: "Request an executor control action (Ansible `meta` alternate): end_play/end_host/reset_connection/etc.",
  source: "builtin",
  args: {
    end_play: { type: "boolean", required: false, description: "End the current play." },
    end_host: { type: "boolean", required: false, description: "End for this host." },
    reset_connection: { type: "boolean", required: false, description: "Reset the connection." },
    clear_facts: { type: "boolean", required: false, description: "Clear live facts for this host." },
    refresh_inventory: { type: "boolean", required: false, description: "Refresh inventory." },
  },
  examples: [
    `- meta:
    end_play: true`,
  ],
  notes: "`noop`, `reset_connection`, and `clear_facts` act immediately. `end_play` halts the play and `end_host` halts the current host (the executor honors the emitted halt signal). `end_batch`/`refresh_inventory`/`flush_handlers` are surfaced in `data.meta.deferred` for the executor to consume (engine support pending).",
};

(metaModule as Module & { meta: ModuleSummary }).meta = metaSummary;
export default metaModule;
