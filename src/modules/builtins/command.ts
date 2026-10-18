// Built-in module: `command` — Ansible `command`/`raw` alias of `shell`.
//
// `command` is NOT a separate execution path. It forwards to `shellModule.run`,
// defaulting `run_mode` to `always` (Ansible `command` reports changed every run)
// unless a path guard (creates/removes) is present, in which case it uses
// `run_mode: idempotent` so the task skips when already satisfied. `raw` is an
// alias of this module. See docs/content/concepts/alternate-modules.md.

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";
import { shellModule } from "./shell";

type RunMode = "idempotent" | "readonly" | "always";

interface CommandArgs {
  cmd?: unknown;
  command?: unknown;
  creates?: unknown;
  removes?: unknown;
  chdir?: unknown;
  run_mode?: unknown;
  _check?: unknown;
  check?: unknown;
}

/** @summary Ansible `command`/`raw` alias of `shell`. Forwards to `shellModule.run`, defaulting `run_mode: always` (or `idempotent` when a `creates`/`removes` guard is set, or honoring an explicit `run_mode`). `chdir` is translated to a `cd` prefix. @param ctx ModuleContext carrying `cmd`/`command`, optional `creates`/`removes`, `chdir`, `run_mode`. @returns ModuleResult from the underlying shell run. */
export const commandModule: Module = {
  name: "command",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const a = ctx.args as unknown as CommandArgs;
    const cmd = String(a.cmd ?? a.command ?? "");
    if (!cmd) return { changed: false, failed: true, msg: "command: 'cmd' (or 'command') is required" };
    const chdir = typeof a.chdir === "string" ? a.chdir : "";
    const fullCmd = chdir ? `cd ${shQuote(chdir)} && ${cmd}` : cmd;
    const hasGuard = a.creates !== undefined || a.removes !== undefined;
    const explicitMode = typeof a.run_mode === "string" ? (a.run_mode as RunMode) : undefined;
    const runMode = explicitMode ?? (hasGuard ? "idempotent" : "always");
    return shellModule.run({
      ...ctx,
      args: { ...a, command: fullCmd, cmd: undefined, run_mode: runMode },
    } as ModuleContext);
  },
};

/** Search metadata for the `command` module. */
export const meta: ModuleSummary = {
  name: "command",
  description:
    "Ansible `command`/`raw` alias of `shell`. Forwards to `shell` with `run_mode: always` (changed every run) or `run_mode: idempotent` when a `creates`/`removes` guard is set (or an explicit `run_mode`). RoleCall always executes via /bin/sh.",
  source: "builtin",
  args: {
    cmd: { type: "string", required: true, description: "Command to run (alias: command)." },
    command: { type: "string", required: false, description: "Alias for `cmd`." },
    creates: { type: "string", required: false, description: "Skip when this path exists (maps to shell idempotent guard)." },
    removes: { type: "string", required: false, description: "Skip when this path is absent (maps to shell idempotent guard)." },
    chdir: { type: "string", required: false, description: "Directory to cd into first (translated to a `cd` prefix)." },
    run_mode: { type: "idempotent | readonly | always", required: false, description: "Override the forwarded shell run_mode (default: always, or idempotent when a guard is set)." },
  },
  examples: [
    `- command:
    cmd: /usr/sbin/setup-balancers.py
    creates: /etc/balancers-enabled`,
    `- command:
    cmd: /opt/app/run.sh
    chdir: /opt/app
    creates: /opt/app/.bootstrapped`,
  ],
  notes:
    "≠ Ansible `command`/`raw`: `command` is an alias of `shell` (no separate no-shell path). A path guard (`creates`/`removes`) makes it `run_mode: idempotent` (skips when satisfied); otherwise it is `run_mode: always` (changed every run). `raw` is the same alias — RoleCall's transport is already shell-based, so there is no Python-less special case. Guards are NOT allowed with `run_mode: readonly`/`always` on `shell`; `command` picks `idempotent` for you when a guard is present, or set `run_mode` explicitly.",
};

(commandModule as Module & { meta: ModuleSummary }).meta = meta;
export default commandModule;
