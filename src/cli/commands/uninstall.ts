// `rolecall uninstall` — ADR 0023 reverse of install.
//
// Plans by default and only applies with `--yes`. Removes the install manifest
// and service unit, stops/disables the service when possible, and keeps
// config/state/cache unless `--purge`. Never deletes the program directory.

import { resolveInstallLayout } from "../../install/layout";
import { applyUninstallPlan, buildUninstallPlan } from "../../install/uninstall";
import { CliError, type CliResult, type GlobalFlags } from "../types";

/** @summary Plan or apply an ADR 0023 uninstall for the selected scope. */
export async function runUninstallCommand(flags: GlobalFlags, _rest: string[]): Promise<CliResult> {
  if (flags.system === true && flags.user === true) {
    throw new CliError(true, "--system and --user are mutually exclusive");
  }
  const root = typeof process.getuid === "function" && process.getuid() === 0;
  const scope = flags.system === true ? "system" : flags.user === true ? "user" : root ? "system" : "user";
  const layout = resolveInstallLayout({
    scope,
    ...(flags.prefix ? { prefix: flags.prefix } : {}),
    ...(flags.configDir ? { configDir: flags.configDir } : {}),
    ...(flags.stateDir ? { stateDir: flags.stateDir } : {}),
  });
  const dryRun = flags.dryRun === true || flags.yes !== true;
  if (!dryRun && scope === "system" && !root) {
    throw new CliError(true, "system-scope uninstall requires root/Administrator");
  }
  const plan = buildUninstallPlan(layout, { purge: flags.purge === true });
  const result = applyUninstallPlan(plan, { dryRun });
  return {
    command: "uninstall",
    plan,
    applied: result.applied,
    removed: result.removed,
    kept: result.kept,
    service: result.service,
  };
}
