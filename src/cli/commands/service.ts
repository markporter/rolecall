// `rolecall service <op>` — ADR 0023 service lifecycle.
//
// Plans by default; `--yes` executes the planned systemctl/launchctl/sc.exe
// commands. `status` is read-only and always runs. `install` also writes the
// unit/manifest via the install helper before enabling it.

import { resolveInstallLayout } from "../../install/layout";
import { applyInstallPlan, buildInstallPlan } from "../../install/plan";
import { buildServicePlan, runServicePlan, serviceUserProblem, type ServiceOperation } from "../../install/service";
import { CliError, type CliResult, type GlobalFlags } from "../types";

const OPS: readonly ServiceOperation[] = ["install", "uninstall", "start", "stop", "restart", "status"];

/** @summary Plan or apply a service lifecycle operation for the install scope. */
export async function runServiceCommand(
  sub: string | undefined,
  _rest: string[],
  flags: GlobalFlags,
): Promise<CliResult> {
  if (!sub || !OPS.includes(sub as ServiceOperation)) {
    throw new CliError(true, `service requires one of: ${OPS.join(", ")}`);
  }
  const operation = sub as ServiceOperation;
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
  const dryRun = operation === "status" ? false : flags.dryRun === true || flags.yes !== true;
  if (!dryRun && scope === "system" && !root) {
    throw new CliError(true, "system-scope service changes require root/Administrator");
  }

  if (operation === "install") {
    const serviceUser = flags.serviceUser ?? "rolecall";
    const userProblem = serviceUserProblem(scope, serviceUser, true);
    if (userProblem) throw new CliError(true, userProblem);
    if (!dryRun) {
      const installPlan = buildInstallPlan({ layout, service: true, isolationBackend: flags.isolation ?? "auto", serviceUser });
      applyInstallPlan(installPlan, { dryRun: false, force: flags.force });
    }
  }

  const plan = buildServicePlan(layout, operation);
  const result = runServicePlan(plan, { dryRun });
  return { command: "service", plan, applied: result.applied, results: result.results };
}
