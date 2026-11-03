// `rolecall install` — ADR 0023 self-installer.
//
// Bare invocation in a TTY walks the operator through scope/paths/service and
// confirms before applying. Flags pre-answer prompts; --non-interactive and
// --yes skip them. Without --yes the default remains a dry-run.

import { createInterface } from "node:readline/promises";
import { resolveInstallLayout, type InstallScope } from "../../install/layout";
import { applyInstallPlan, buildInstallPlan } from "../../install/plan";
import { serviceUserProblem } from "../../install/service";
import { CliError, type CliResult, type GlobalFlags } from "../types";

export interface InstallWizardOptions {
  /** Force/disable prompting (defaults to TTY + no --yes/--dry-run/--non-interactive). */
  interactive?: boolean;
  /** Injectable prompt for tests. */
  ask?: (question: string, fallback: string) => Promise<string>;
}

function yesNo(value: string, fallback: boolean): boolean {
  const v = value.trim().toLowerCase();
  if (v === "") return fallback;
  return v === "y" || v === "yes" || v === "true" || v === "1";
}

async function confirm(
  ask: (q: string, d: string) => Promise<string>,
  question: string,
  fallback: boolean,
): Promise<boolean> {
  return yesNo(await ask(`${question} ${fallback ? "[Y/n]" : "[y/N]"}`, ""), fallback);
}

/** @summary Plan/apply an ADR 0023 install, with a TTY wizard unless flags answer everything. */
export async function runInstallCommand(
  flags: GlobalFlags,
  _rest: string[],
  opts: InstallWizardOptions = {},
): Promise<CliResult> {
  if (flags.system === true && flags.user === true) {
    throw new CliError(true, "--system and --user are mutually exclusive");
  }
  const root = typeof process.getuid === "function" && process.getuid() === 0;
  const tty = process.stdin.isTTY === true && process.stdout.isTTY === true;
  const interactive =
    opts.interactive ??
    (tty && flags.nonInteractive !== true && flags.yes !== true && flags.dryRun !== true);
  const ask =
    opts.ask ??
    (async (q: string, fallback: string): Promise<string> => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const value = await rl.question(fallback ? `${q} [${fallback}]: ` : `${q}: `);
        return value.trim() || fallback;
      } finally {
        rl.close();
      }
    });

  let scope: InstallScope = flags.system === true ? "system" : flags.user === true ? "user" : root ? "system" : "user";
  let prefix = flags.prefix;
  let configDir = flags.configDir;
  let stateDir = flags.stateDir;
  let service = flags.noService !== true;
  let serviceUser = flags.serviceUser ?? "rolecall";
  let apply = flags.yes === true && flags.dryRun !== true;

  if (interactive) {
    if (flags.system !== true && flags.user !== true) {
      const answer = (await ask("Install scope (system/user)", scope)).toLowerCase();
      if (answer !== "system" && answer !== "user") throw new CliError(true, `invalid scope '${answer}'`);
      scope = answer;
    }
    const defaults = resolveInstallLayout({ scope, ...(prefix ? { prefix } : {}), ...(configDir ? { configDir } : {}), ...(stateDir ? { stateDir } : {}) });
    if (!prefix) prefix = await ask("Program directory", defaults.programDir);
    if (!configDir) configDir = await ask("Config directory", defaults.configDir);
    if (!stateDir) stateDir = await ask("State directory", defaults.stateDir);
    service = await confirm(ask, "Install a service?", service);
    if (service && scope === "system") serviceUser = await ask("System service account", serviceUser);
    apply = await confirm(ask, "Apply this install?", true);
    if (!apply) {
      // Show the plan and exit without writing.
    }
  }

  if (apply && scope === "system" && !root) {
    throw new CliError(true, "system-scope install requires root/Administrator; rerun with --user or as root");
  }
  const userProblem = serviceUserProblem(scope, serviceUser, service);
  if (userProblem) throw new CliError(true, userProblem);

  const layout = resolveInstallLayout({
    scope,
    ...(prefix ? { prefix } : {}),
    ...(configDir ? { configDir } : {}),
    ...(stateDir ? { stateDir } : {}),
  });
  const plan = buildInstallPlan({
    layout,
    service,
    isolationBackend: flags.isolation ?? "auto",
    serviceUser,
    ...(flags.fromDir ? { fromDir: flags.fromDir } : {}),
  });
  const result = applyInstallPlan(plan, { dryRun: !apply, force: flags.force });
  return {
    command: "install",
    plan,
    applied: result.applied,
    written: result.written,
    warnings: result.warnings,
  };
}
