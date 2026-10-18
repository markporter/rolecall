// Unified `shell` module (formerly `shell_guarded`, originally `cli`, Todo 27).
//
// Runs an arbitrary command on the target host via the connection. Idempotency is
// controlled by a single `run_mode` (default `idempotent`):
//
//   * `idempotent` (default) — a guard (creates/removes/creates_cmd/removes_cmd) is
//     REQUIRED; applying without one throws, nudging you to make the command
//     repeatable. When a guard IS present, `shell` uses pre-checks inside `describe`
//     to skip already-satisfied work.
//   * `readonly` — a pure check (e.g. `nginx -t`): runs every time but always reports
//     `changed: false`. Never throws for a missing guard.
//   * `always` — fire-and-forget: runs every time, always `changed: true`, never
//     throws. Use for one-shots that genuinely cannot be guarded.
//
// When `become` is requested the whole script is wrapped as `sudo sh -c '<shQuote>'`
// (single-quoting safely escapes embedded single quotes) unless it already starts
// with `sudo `. An explicit `executable` runs the command as `<executable> -c '<shQuote>'`
// instead of the default shell. Guards share that same privilege. A `verify_cmd` runs AFTER the
// main command and flips `failed` when it exits non-zero. `--dry-run` (the `_check`
// flag or `dry_run: true`) reports what WOULD run without executing anything. This is
// the module the lint guard in src/config/loader.ts steers unguarded shell tasks
// toward.

import type { Module } from "../../executor/module";
import type { CheckableModule } from "../../idempotency/types";
import { resource } from "../resource";
import { shQuote, wrapCommand } from "./fs";
import type { ModuleSummary } from "../search";
import { readFileSync } from "node:fs";

/** Search metadata for the `shell` module (auto-collected by builtins/index.ts). */
export const meta: ModuleSummary = {
  name: "shell",
  description:
    "Idempotency-aware CLI module controlled by `run_mode` (idempotent|readonly|always; default idempotent). In `idempotent` mode a guard (creates/removes/creates_cmd/removes_cmd) is required or apply throws; `readonly` runs every time but reports changed:false (a pure check); `always` runs every time and is always changed. Supports --dry-run, verify_cmd, a per-task timeout_seconds (seconds), and an explicit executable (shell binary).",
  idempotent: true,
  source: "builtin",
  args: {
    command: {
      type: "string",
      required: true,
      description: "Command to run (alias: cmd). Use the $template operator to embed vars/facts.",
    },
    cmd: { type: "string", required: false, description: "Alias for command." },
    src: {
      type: "string",
      required: false,
      description: "Path to a script/file already on the target; run it directly (alternative to `command`).",
    },
    local_src: {
      type: "string",
      required: false,
      description: "Path to a script on the control node; read here and execute via the target shell (the `script` module is an alias of this).",
    },
    run_mode: {
      type: "string",
      required: false,
      description:
        "How the task treats idempotency. `idempotent` (default): require a guard or apply throws; `readonly`: run every time but always report changed:false (a pure check); `always`: run every time and always report changed:true. See Writing idempotent shell tasks (/concepts/shell-idempotency).",
    },
    creates: {
      type: "string",
      required: false,
      description: "When this path exists on the target, the task is already done (skip).",
    },
    removes: {
      type: "string",
      required: false,
      description: "When this path is absent on the target, the task is already done (skip).",
    },
    creates_cmd: {
      type: "string",
      required: false,
      description:
        "Precedence guard: full shell command; if it exits 0 the work is already done (skip). Takes precedence over creates/removes.",
    },
    removes_cmd: {
      type: "string",
      required: false,
      description:
        "Precedence guard: full shell command; if it exits non-zero the work is already done (skip). Takes precedence over creates/removes.",
    },
    verify_cmd: {
      type: "string",
      required: false,
      description:
        "Post-check: after the main command runs, exec it; exitCode !== 0 marks the result failed (changed is otherwise unchanged).",
    },
    dry_run: {
      type: "boolean",
      required: false,
      description: "Dry-run: report what would run, execute nothing.",
    },
    timeout_seconds: {
      type: "number",
      required: false,
      description: "Optional per-task exec timeout in seconds (long-running commands only; the transport default applies otherwise).",
    },
    executable: {
      type: "string",
      required: false,
      description: "Explicit shell/process binary used to run the command (e.g. /bin/bash); defaults to /bin/sh (local) or the remote login shell. The command is executed as `<executable> -c '<cmd>'`.",
    },
  },
  // Block-YAML task snippets using RoleCall's structured `$var`/`$concat`/`$call`/`$template`
  // templating (never Jinja `{{ }}`).
  examples: [
    `- shell:
    command: systemctl restart nginx
    creates: /run/nginx.pid`,
    `- shell:
    command: enable-feature --apply
    creates_cmd: feature --status | grep -q enabled
    verify_cmd: curl -sf http://localhost/health`,
    `# One-shot / fire-and-forget? Run every time, always changed:
- shell:
    command: "apt-get install -y nginx"
    run_mode: always`,
    `# Pure read-only check (runs every time, never "changed"):
- shell:
    command: "nginx -t"
    run_mode: readonly`,
    `# Reference vars/facts with $template (RoleCall does not render {{ }}):
- shell:
    command:
      $template: "echo host <%= vars.cimc_host %> is <%= facts.os %>"
    run_mode: always`,
    `# Multi-line scripts pass verbatim to /bin/sh (newlines preserved):
- shell:
    command: |
      set -e
      echo "bootstrapping <%= vars.role %>"
      touch /opt/app/.bootstrapped
    run_mode: always`,
    `# Long-running commands: set a timeout in seconds (the transport default applies otherwise):
- shell:
    command: "make -C /src all"
    run_mode: always
    timeout_seconds: 1800`,
    `# Run via an explicit shell/process instead of /bin/sh:
- shell:
    command: "source /opt/venv/bin/activate && pip list"
    executable: /bin/bash
    run_mode: always`,
  ],
    notes:
    "≠ Ansible `shell`: executes via `/bin/sh` (local) or the remote login shell over SSH unless an explicit `executable` is set (then `<executable> -c '<cmd>'`) — RoleCall has no `command` vs `shell` split. Guarded by default via `run_mode: idempotent` (set `run_mode: always` for unguarded runs, `run_mode: readonly` for pure checks). When idempotent, skips via creates/removes/creates_cmd/removes_cmd so re-runs can be no-ops. The command comes from `command`/`cmd` (inline), `local_src` (a control-node script read here — the `script` module is an alias of this), or `src` (a script already on the target, run directly). A guard combined with `run_mode: readonly`/`always` throws. See Writing idempotent shell tasks (/concepts/shell-idempotency) for the full guide, including multi-line scripts, $template vars/facts, and read-only checks.",
};

type RunMode = "idempotent" | "readonly" | "always";

interface ShellArgs {
  /** Command to run. Required. (alias: `cmd`.) */
  command?: string;
  cmd?: string;
  /** Path to a script/file already on the target; run it directly (alternative to `command`). */
  src?: string;
  /** Path to a script on the control node; read here and execute via the target shell (the `script` module is an alias of this). */
  local_src?: string;
  /** Idempotency mode. Defaults to `idempotent`. */
  run_mode?: RunMode;
  /** When this path exists on the target, the task is already done (skip). */
  creates?: string;
  /** When this path is absent on the target, the task is already done (skip). */
  removes?: string;
  /** Full shell pre-check command; exit 0 means already satisfied (skip). */
  creates_cmd?: string;
  /** Full shell pre-check command; non-zero exit means already satisfied (skip). */
  removes_cmd?: string;
  /** Optional post-check command; non-zero exit marks the result failed. */
  verify_cmd?: string;
  /** Dry-run: report what would run, execute nothing. */
  dry_run?: boolean;
  /** Optional per-task exec timeout in seconds; overrides the transport default so long-running commands like image downloads are not killed. */
  timeout_seconds?: number;
  /** Explicit shell/process binary to run the command with (e.g. /bin/bash); defaults to /bin/sh. The command is executed as `<executable> -c '<cmd>'`. */
  executable?: string;
}

/** Resolve the final command string to exec. When `executable` is set the command
 * runs as `<executable> -c '<shQuote(cmd)>'` instead of the default shell; otherwise the
 * raw command is used. When `become` is requested the result is wrapped under
 * `sudo sh -c '<shQuote>'` (single-quoting safely escapes embedded single quotes)
 * unless it already starts with `sudo ` (avoid double-sudo). */
function shellWrap(cmd: string, executable: string | undefined, become: boolean, becomeUser?: string, environment?: Record<string, string>): string {
  const inner = executable ? `${executable} -c ${shQuote(cmd)}` : cmd;
  if (inner.startsWith("sudo ")) return inner; // user already escalated; avoid double-sudo
  return wrapCommand(inner, { become, becomeUser, environment });
}

/** Resolve `run_mode` (default `idempotent`) and validate it. */
function resolveRunMode(a: ShellArgs): RunMode {
  const mode = a.run_mode ?? "idempotent";
  if (mode !== "idempotent" && mode !== "readonly" && mode !== "always") {
    throw new Error(
      `shell: invalid run_mode '${mode}' (expected idempotent|readonly|always)`,
    );
  }
  return mode;
}

/** Whether any idempotency guard is present. */
function hasGuard(a: ShellArgs): boolean {
  return (
    a.creates !== undefined ||
    a.removes !== undefined ||
    a.creates_cmd !== undefined ||
    a.removes_cmd !== undefined
  );
}

/** Guards only make sense in `run_mode: idempotent`. A guard combined with
 * `readonly`/`always` is contradictory (skip-if-done vs always-run) and throws. */
function assertGuardModeConsistent(a: ShellArgs): void {
  const mode = a.run_mode ?? "idempotent";
  if (mode !== "idempotent" && hasGuard(a)) {
    throw new Error(
      `shell: guards (creates/removes/creates_cmd/removes_cmd) only apply in run_mode: idempotent; ` +
        `remove the guard or set run_mode: idempotent (got run_mode: ${mode})`,
    );
  }
}

/** Resolve the command string from inline `command`/`cmd`, a local control-node
 * `local_src` (read here), or a target-side `src` path (run directly). */
function resolveCommand(a: ShellArgs): string {
  const inline = a.command ?? a.cmd;
  if (inline !== undefined && inline !== "") return String(inline);
  if (a.local_src !== undefined) {
    try {
      return readFileSync(String(a.local_src), "utf8");
    } catch (e) {
      throw new Error(
        `shell: cannot read local_src '${a.local_src}': ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  if (a.src !== undefined) return String(a.src);
  return "";
}

/** @summary Idempotency-aware CLI module controlled by `run_mode`. Throws in `idempotent` mode when no guard is set; `readonly` forces changed:false; `always` always runs. Supports --dry-run, verify_cmd, sudo-sh wrapping on become, and an explicit `executable`. @param args ShellArgs (command/cmd, run_mode, creates, removes, creates_cmd, removes_cmd, verify_cmd, dry_run, timeout_seconds, executable). @returns Module & CheckableModule. */
export const shellModule: Module & CheckableModule = resource({
  name: "shell",
  async describe(args, ctx) {
    const a = args as unknown as ShellArgs;
    assertGuardModeConsistent(a);
    const cmd = resolveCommand(a);
    if (!cmd) return { current: null, inDesired: false };
    const mode = resolveRunMode(a);
    const conn = ctx.connection;
    const timeoutOpts = a.timeout_seconds && a.timeout_seconds > 0 ? { timeoutMs: a.timeout_seconds * 1000 } : undefined;
    const bec = Boolean(ctx.become);

    // `always`: never skip — always run.
    if (mode === "always") return { current: null, inDesired: false };

    // `idempotent`: enforce a guard or throw.
    if (mode === "idempotent" && !hasGuard(a)) {
      throw new Error(
        "shell: run_mode is 'idempotent' but no idempotency guard set (creates/removes/creates_cmd/removes_cmd). " +
          "Add a guard so re-runs are safe, set run_mode: always to run unconditionally, or run_mode: readonly for a pure check.",
      );
    }

    // Precedence #1: command-based guards (full multi-statement scripts allowed).
    if (a.creates_cmd !== undefined || a.removes_cmd !== undefined) {
      if (a.creates_cmd !== undefined) {
        const r = await conn.exec(
          shellWrap(String(a.creates_cmd), a.executable, bec),
          timeoutOpts,
        );
        if (r.exitCode === 0) return { current: { created: true }, inDesired: true };
      }
      if (a.removes_cmd !== undefined) {
        const r = await conn.exec(
          shellWrap(String(a.removes_cmd), a.executable, bec),
          timeoutOpts,
        );
        if (r.exitCode !== 0) return { current: { removed: true }, inDesired: true };
      }
      return { current: null, inDesired: false };
    }

    // Precedence #2: classic path guards (test -e <path>).
    if (a.removes) {
      const r = await conn.exec(
          shellWrap(`test -e ${shQuote(String(a.removes))}`, a.executable, bec),
        timeoutOpts,
      );
      const inDesired = r.exitCode !== 0; // already removed
      return { current: { removed: inDesired }, inDesired };
    }
    if (a.creates) {
      const r = await conn.exec(
          shellWrap(`test -e ${shQuote(String(a.creates))}`, a.executable, bec),
        timeoutOpts,
      );
      const inDesired = r.exitCode === 0; // already created
      return { current: { created: inDesired }, inDesired };
    }

    // No guard: `readonly`/`idempotent` both apply (idempotent already threw above
    // when unguarded). Always apply.
    return { current: null, inDesired: false };
  },
  async converge(args, ctx) {
    const a = args as unknown as ShellArgs;
    assertGuardModeConsistent(a);
    const cmd = resolveCommand(a);
    if (!cmd) {
      return { changed: false, failed: true, msg: "shell: 'command' (or 'cmd'/'local_src'/'src') is required" };
    }
    const mode = resolveRunMode(a);
    const dryRun = Boolean(a.dry_run) || Boolean((args as Record<string, unknown>)["_check"]);
    if (dryRun) {
      return {
        changed: false,
        msg: `would run: ${cmd}`,
        data: { dryRun: true, command: cmd },
      };
    }
    const conn = ctx.connection;
    const bec = Boolean(ctx.become);
    const timeoutOpts = a.timeout_seconds && a.timeout_seconds > 0 ? { timeoutMs: a.timeout_seconds * 1000 } : undefined;
    // Escalate privileges when `become` is requested by wrapping the WHOLE script
    // under `sudo sh -c '<shQuote>'` (safe against embedded single quotes), unless
    // the command already starts with `sudo` (avoid double-sudo). Timeout handling
    // is unchanged.
    const execCmd = shellWrap(cmd, a.executable, bec, ctx.become_user, ctx.environment);
    const res = await conn.exec(execCmd, timeoutOpts);
    const exitCode = res.exitCode ?? 0;
    let changed = true;
    // `always` ignores guards and is always changed. `idempotent`/`readonly` honor
    // a present guard for the changed computation.
    if (mode !== "always") {
      if (a.creates) {
        const t = await conn.exec(shellWrap(`test -e ${shQuote(String(a.creates))}`, a.executable, bec, ctx.become_user, ctx.environment), timeoutOpts);
        changed = t.exitCode === 0;
      } else if (a.removes) {
        const t = await conn.exec(shellWrap(`test -e ${shQuote(String(a.removes))}`, a.executable, bec, ctx.become_user, ctx.environment), timeoutOpts);
        changed = t.exitCode !== 0;
      }
    }
    // `readonly`: a pure check never mutates managed state.
    if (mode === "readonly") changed = false;
    // Verify step: after the main command runs, run verify_cmd (if set) and mark
    // failed on non-zero exit. Separate from the guard `changed` recompute.
    let verifyFailed = false;
    if (a.verify_cmd !== undefined) {
      const vres = await conn.exec(
          shellWrap(String(a.verify_cmd), a.executable, bec),
        timeoutOpts,
      );
      verifyFailed = vres.exitCode !== 0;
    }
    return {
      changed,
      failed: exitCode !== 0 || verifyFailed,
      stdout: res.stdout,
      stderr: res.stderr,
      msg: `ran: ${cmd}`,
      data: { exitCode, command: cmd, verifyResult: verifyFailed },
    };
  },
});

(shellModule as Module & CheckableModule & { meta: ModuleSummary }).meta = meta;
