// Network-device configuration module used by serve-mode network targets.
//
// Computes a candidate-vs-running diff with the same diff engine as the network
// transport/simulator, then applies only the added lines (merge) or the full
// normalized candidate (replace), followed by a commit. `check` reports
// would-change without touching the device.

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { CheckableModule } from "../../idempotency/types";
import { diffConfigs, normalizeConfig } from "../../transport/diff";
import type { ModuleSummary } from "../search";

export const meta: ModuleSummary = {
  name: "set_config",
  description: "Apply a candidate network-device configuration by diffing against the running config, then commit.",
  idempotent: true,
  source: "builtin",
  args: {
    config: { type: "string", required: true, description: "Candidate configuration (newline-separated CLI lines)." },
    mode: { type: "string", required: false, description: "merge (default) applies added lines; replace sends the full normalized candidate." },
    commit: { type: "boolean", required: false, description: "Commit the candidate after applying (default true)." },
  },
  examples: [
    `- name: Push switch configuration
  set_config:
    config: |
      hostname sw1
      interface Gi0/1
      description uplink
    mode: merge
    commit: true`,
  ],
  notes: "Network transports only. Idempotent against show running-config; --force re-applies even when the diff is empty.",
};

interface SetConfigArgs {
  config: string;
  mode?: "merge" | "replace";
  commit?: boolean;
}

function readArgs(args: Record<string, unknown>): SetConfigArgs {
  return {
    config: typeof args["config"] === "string" ? args["config"] : "",
    mode: args["mode"] === "replace" ? "replace" : "merge",
    commit: args["commit"] !== false,
  };
}

export const setConfigModule: Module & CheckableModule = {
  name: "set_config",
  async check(args, ctx) {
    const a = readArgs(args);
    const running = await ctx.connection.exec("show running-config");
    if (running.exitCode !== 0) {
      return { current: running.stderr, inDesired: false };
    }
    const diff = diffConfigs(a.config, running.stdout);
    return { current: running.stdout, inDesired: !diff.changed };
  },
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const a = readArgs(ctx.args);
    if (!a.config.trim()) {
      return { changed: false, failed: true, msg: "set_config: 'config' is required" };
    }
    const running = await ctx.connection.exec("show running-config");
    if (running.exitCode !== 0) {
      return { changed: false, failed: true, msg: "set_config: could not read running-config", stderr: running.stderr };
    }
    const diff = diffConfigs(a.config, running.stdout);
    const forced = ctx.args["force"] === true;
    if (!diff.changed && !forced) {
      return { changed: false, msg: "configuration already in desired state" };
    }

    const lines =
      a.mode === "replace"
        ? normalizeConfig(a.config).split("\n").filter((l) => l.trim().length > 0)
        : diff.added;
    if (lines.length > 0) {
      const enter = await ctx.connection.exec("configure terminal");
      if (enter.exitCode !== 0) {
        return { changed: false, failed: true, msg: "set_config: could not enter configuration mode", stderr: enter.stderr };
      }
      for (const line of lines) {
        const applied = await ctx.connection.exec(line);
        if (applied.exitCode !== 0) {
          await ctx.connection.exec("end");
          return { changed: false, failed: true, msg: `set_config: rejected '${line}'`, stderr: applied.stderr };
        }
      }
      const exit = await ctx.connection.exec("end");
      if (exit.exitCode !== 0) {
        return { changed: false, failed: true, msg: "set_config: could not exit configuration mode", stderr: exit.stderr };
      }
    }
    if (a.commit) {
      const commit = await ctx.connection.exec("write memory");
      if (commit.exitCode !== 0) {
        return { changed: false, failed: true, msg: "set_config: commit failed", stderr: commit.stderr };
      }
    }
    return {
      changed: true,
      msg: forced && !diff.changed ? "applied (forced)" : "configuration applied",
      data: { added: diff.added, removed: diff.removed, mode: a.mode, committed: a.commit },
    };
  },
};
