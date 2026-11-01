// Built-in module: `meta` — Ansible `meta` alternate (executor control flags).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";

/** @summary Request an executor control action (Ansible `meta` alternate). @param ctx ModuleContext carrying control flags. @returns ModuleResult; `noop`/`reset_connection`/`clear_facts` act immediately, while `end_play`/`end_host` emit a halt signal and `end_batch`/`refresh_inventory`/`flush_handlers` are surfaced as wired flags the engine consumes at the next task boundary. */
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
    const wired: string[] = [];
    for (const k of ["end_play", "end_host", "end_batch", "refresh_inventory", "flush_handlers"] as const) {
      if (truthy(k)) wired.push(k);
    }
    const deferred: string[] = [];
    const skipped = acted.length === 0 && wired.length === 0 && deferred.length === 0;
    const halt: "play" | "host" | undefined = wired.includes("end_play")
      ? "play"
      : wired.includes("end_host")
        ? "host"
        : undefined;
    return {
      changed: false,
      skipped,
      msg: `meta: acted [${acted.join(", ") || "none"}] wired [${wired.join(", ") || "none"}] deferred [${deferred.join(", ") || "none"}]`,
      data: {
        meta: {
          acted,
          wired,
          deferred,
          end_play: wired.includes("end_play"),
          end_host: wired.includes("end_host"),
          end_batch: wired.includes("end_batch"),
          refresh_inventory: wired.includes("refresh_inventory"),
          flush_handlers: wired.includes("flush_handlers"),
        },
      },
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
    end_batch: { type: "boolean", required: false, description: "End the current serial batch (the next batch continues)." },
    flush_handlers: { type: "boolean", required: false, description: "Flush pending handlers immediately." },
    reset_connection: { type: "boolean", required: false, description: "Reset the connection." },
    clear_facts: { type: "boolean", required: false, description: "Clear live facts for this host." },
    refresh_inventory: { type: "boolean", required: false, description: "Re-read the inventory source when one is configured." },
  },
  examples: [
    `- meta:
    end_play: true`,
  ],
  notes: "`noop`, `reset_connection`, and `clear_facts` act immediately. `end_play` halts the play and `end_host` halts the current host (the executor honors the emitted halt signal). `flush_handlers` flushes pending handlers at that point, `end_batch` stops the current serial batch (the next batch continues), and `refresh_inventory` re-reads `ExecOptions.inventoryPath` and re-resolves hosts (a safe no-op with a clear note when no inventory source is available). All control flags are honored.",
};

(metaModule as Module & { meta: ModuleSummary }).meta = metaSummary;
export default metaModule;
