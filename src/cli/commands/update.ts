// `rolecall update` — ADR 0023 versioned update/rollback (local --from-dir).
//
// `--check` is read-only. Applying stages a verified binary, atomically switches
// the current symlink, updates the manifest, and restarts the service unless
// --no-restart. Network/channel discovery is not implemented.

import { resolveInstallLayout } from "../../install/layout";
import { applyUpdatePlan, buildUpdatePlan, checkUpdate } from "../../install/update";
import { CliError, type CliResult, type GlobalFlags } from "../types";

/** @summary Check, apply, or roll back a versioned ADR 0023 update. */
export async function runUpdateCommand(flags: GlobalFlags, _rest: string[]): Promise<CliResult> {
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

  if (flags.check === true) {
    const check = checkUpdate(layout, flags.fromDir);
    return { command: "update", check, applied: false, written: [], service: [] };
  }

  const plan = buildUpdatePlan(layout, {
    ...(flags.fromDir ? { fromDir: flags.fromDir } : {}),
    rollback: flags.rollback === true,
    restart: flags.noRestart !== true,
  });
  const dryRun = flags.dryRun === true || flags.yes !== true;
  if (!dryRun && scope === "system" && !root) {
    throw new CliError(true, "system-scope update requires root/Administrator");
  }
  const result = applyUpdatePlan(layout, plan, { dryRun, restart: flags.noRestart !== true });
  return {
    command: "update",
    plan,
    applied: result.applied,
    ...(result.fromVersion ? { fromVersion: result.fromVersion } : {}),
    ...(result.toVersion ? { toVersion: result.toVersion } : {}),
    written: result.written,
    service: result.service,
  };
}
