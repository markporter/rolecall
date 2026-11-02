// `rolecall install` — ADR 0023 self-installer (first slice).
//
// Plans the layout/config/manifest/service unit; applies only with `--yes` and
// only into the resolved config/state/cache dirs. It never installs packages,
// copies the binary, enables a service, or edits PATH.

import { resolveInstallLayout } from "../../install/layout";
import { applyInstallPlan, buildInstallPlan } from "../../install/plan";
import { CliError, type CliResult, type GlobalFlags } from "../types";

/** @summary Plan (default) or apply an ADR 0023 install for the selected scope. */
export async function runInstallCommand(
  flags: GlobalFlags,
  _rest: string[],
): Promise<CliResult> {
  if (flags.system === true && flags.user === true) {
    throw new CliError(true, "--system and --user are mutually exclusive");
  }
  const root = typeof process.getuid === "function" && process.getuid() === 0;
  const scope = flags.system === true ? "system" : flags.user === true ? "user" : root ? "system" : "user";
  const apply = flags.yes === true && flags.dryRun !== true;
  if (apply && scope === "system" && !root) {
    throw new CliError(true, "system-scope install requires root/Administrator; rerun with --user or as root");
  }

  const layout = resolveInstallLayout({
    scope,
    ...(flags.prefix ? { prefix: flags.prefix } : {}),
    ...(flags.configDir ? { configDir: flags.configDir } : {}),
    ...(flags.stateDir ? { stateDir: flags.stateDir } : {}),
  });
  const plan = buildInstallPlan({
    layout,
    service: flags.noService !== true,
    isolationBackend: flags.isolation ?? "auto",
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
