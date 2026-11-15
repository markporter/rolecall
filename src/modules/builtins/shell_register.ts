// Built-in module: `shell_register` — observation/probe command runner.
//
// Runs a command on the target, captures rc/stdout/stderr into the task's
// `register` result, and reports `changed: false` by default. Unlike `shell`,
// there is no idempotency guard or `run_mode`; this module is for probing and
// for the Ansible `changed_when: false` / `failed_when: false` pattern.
//
// `capture_errors: true` records a non-zero rc as data instead of failing the
// task. Error handling stays explicit: the default is still to fail.

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote, wrapCommand } from "./fs";

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** @summary Run a command and capture rc/stdout/stderr without treating a non-zero rc as failure when `capture_errors` is set. @param ctx ModuleContext carrying `command`/`cmd`, `changed`, `capture_errors`, `chdir`, `executable`, and `timeout_seconds`. @returns ModuleResult with `data.{rc,stdout,stderr}`; changed is false unless `changed: true`. */
export const shellRegisterModule: Module = {
  name: "shell_register",
  supportsCheck: true,
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const args = ctx.args;
    const command = asString(args["command"]) ?? asString(args["cmd"]);
    if (command === undefined) {
      return { changed: false, failed: true, msg: "shell_register: 'command' (or 'cmd') is required" };
    }
    const changed = args["changed"] === true;
    const check = args["_check"] === true || args["check"] === true;
    if (check && changed) {
      return {
        changed: false,
        skipped: true,
        msg: "shell_register: would run (dry run)",
        data: { check: true, wouldChange: true },
      };
    }
    const executable = asString(args["executable"]);
    const base = executable === undefined ? command : `${shQuote(executable)} -c ${shQuote(command)}`;
    const cmd = wrapCommand(base, {
      become: Boolean(ctx.become),
      becomeUser: ctx.become_user,
      environment: ctx.environment,
    });
    const timeoutSeconds = typeof args["timeout_seconds"] === "number" ? args["timeout_seconds"] : undefined;
    const cwd = asString(args["chdir"]);
    const res = await ctx.connection.exec(cmd, {
      ...(cwd !== undefined ? { cwd } : {}),
      ...(timeoutSeconds !== undefined ? { timeoutMs: timeoutSeconds * 1000 } : {}),
    });
    const rc = res.exitCode ?? 1;
    const captureErrors = args["capture_errors"] === true;
    const failed = rc !== 0 && !captureErrors;
    return {
      changed,
      ...(failed ? { failed: true } : {}),
      stdout: res.stdout,
      stderr: res.stderr,
      ...(failed ? { msg: `shell_register: command exited ${rc}` } : {}),
      data: { rc, stdout: res.stdout, stderr: res.stderr },
    };
  },
};

/** Search metadata for the `shell_register` module. */
export const meta: ModuleSummary = {
  name: "shell_register",
  description:
    "Run a command and capture rc/stdout/stderr into the task register (probe/observation semantics; changed defaults false). Use `capture_errors: true` to record a non-zero rc instead of failing.",
  idempotent: true,
  source: "builtin",
  args: {
    command: { type: "string", required: true, description: "Command to run (alias: cmd)." },
    cmd: { type: "string", required: false, description: "Alias for command." },
    changed: {
      type: "boolean",
      required: false,
      description: "Report the task as changed (default false; set true for a mutating command).",
    },
    capture_errors: {
      type: "boolean",
      required: false,
      description: "Record a non-zero rc in data.rc instead of failing the task (default false).",
    },
    chdir: { type: "string", required: false, description: "Working directory for the command." },
    executable: {
      type: "string",
      required: false,
      description: "Explicit shell/process binary; the command runs as `<executable> -c '<cmd>'`.",
    },
    timeout_seconds: { type: "number", required: false, description: "Per-command timeout in seconds." },
  },
  examples: [
    `- shell_register:
    command: test -f /etc/app.conf
    capture_errors: true
  register: app_conf_probe

- debug:
    msg:
      $var: reg.app_conf_probe.data.rc`,
    `- shell_register:
    command: systemctl is-active nginx
    capture_errors: true
  register: nginx_probe`,
  ],
  notes:
    "Observation semantics: changed defaults false and there is no run_mode/guard. `capture_errors: true` records non-zero rc without failing; use `when` on the registered rc to branch. This replaces Ansible's changed_when:false + failed_when:false + register probe pattern.",
};

(shellRegisterModule as Module & { meta: ModuleSummary }).meta = meta;
export default shellRegisterModule;
