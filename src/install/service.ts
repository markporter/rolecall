// ADR 0023 service lifecycle: pure command plans for the supported managers.
// Tests assert the plan; execution is opt-in (`--yes`) and injectable.

import { spawnSync } from "node:child_process";
import { join } from "node:path";

import type { InstallLayout } from "./layout";
import { readInstallManifest, serviceManagerFor, serviceUnitPath, type ServiceManager } from "./plan";

export type ServiceOperation = "install" | "uninstall" | "start" | "stop" | "restart" | "status";

export interface ServiceCommand {
  file: string;
  args: string[];
}

export interface ServicePlan {
  operation: ServiceOperation;
  manager: ServiceManager;
  unitPath?: string;
  commands: ServiceCommand[];
  actions: string[];
  requiresRoot: boolean;
  /** Read-only status can run without --yes. */
  readOnly: boolean;
}

export interface BuildServicePlanOptions {
  /** Override manager (defaults to the install manifest, else platform). */
  manager?: ServiceManager;
  /** Unit path override. */
  unitPath?: string;
  /** User id for launchd gui/<uid> (defaults to process.getuid()). */
  uid?: number;
}

function execPath(layout: InstallLayout): string {
  return join(layout.programDir, "rolecall");
}

function systemdPlan(layout: InstallLayout, op: ServiceOperation, unitPath: string): ServicePlan {
  const ctl = layout.scope === "user" ? ["systemctl", "--user"] : ["systemctl"];
  const cmd = (...args: string[]): ServiceCommand => ({ file: ctl[0]!, args: [...ctl.slice(1), ...args] });
  const commands: ServiceCommand[] = [];
  const actions: string[] = [];
  switch (op) {
    case "install":
      actions.push(`write ${unitPath}`, "systemctl daemon-reload", "systemctl enable --now rolecall");
      commands.push(cmd("daemon-reload"), cmd("enable", "--now", "rolecall"));
      break;
    case "uninstall":
      actions.push("systemctl disable --now rolecall", "systemctl daemon-reload");
      commands.push(cmd("disable", "--now", "rolecall"), cmd("daemon-reload"));
      break;
    case "status":
      actions.push("systemctl is-active rolecall");
      commands.push(cmd("is-active", "rolecall"));
      break;
    default:
      actions.push(`systemctl ${op} rolecall`);
      commands.push(cmd(op, "rolecall"));
  }
  return {
    operation: op,
    manager: "systemd",
    unitPath,
    commands,
    actions,
    requiresRoot: layout.scope === "system",
    readOnly: op === "status",
  };
}

function launchdPlan(layout: InstallLayout, op: ServiceOperation, unitPath: string, uid: number): ServicePlan {
  const domain = layout.scope === "user" ? `gui/${uid}` : "system";
  const label = "com.rolecall.serve";
  const commands: ServiceCommand[] = [];
  const actions: string[] = [];
  const run = (...args: string[]): ServiceCommand => ({ file: "launchctl", args });
  switch (op) {
    case "install":
      actions.push(`write ${unitPath}`, `launchctl bootstrap ${domain} ${unitPath}`);
      commands.push(run("bootstrap", domain, unitPath));
      break;
    case "uninstall":
      actions.push(`launchctl bootout ${domain}/${label}`);
      commands.push(run("bootout", `${domain}/${label}`));
      break;
    case "start":
    case "restart":
      actions.push(`launchctl kickstart -k ${domain}/${label}`);
      commands.push(run("kickstart", "-k", `${domain}/${label}`));
      break;
    case "stop":
      actions.push(`launchctl kill SIGTERM ${domain}/${label}`);
      commands.push(run("kill", "SIGTERM", `${domain}/${label}`));
      break;
    case "status":
      actions.push(`launchctl print ${domain}/${label}`);
      commands.push(run("print", `${domain}/${label}`));
      break;
  }
  return {
    operation: op,
    manager: "launchd",
    unitPath,
    commands,
    actions,
    requiresRoot: layout.scope === "system",
    readOnly: op === "status",
  };
}

function windowsPlan(layout: InstallLayout, op: ServiceOperation): ServicePlan {
  const service = "RoleCall";
  const bin = `"${execPath(layout)}" --serve`;
  const commands: ServiceCommand[] = [];
  const actions: string[] = [];
  const sc = (...args: string[]): ServiceCommand => ({ file: "sc.exe", args });
  switch (op) {
    case "install":
      actions.push(`sc.exe create ${service}`, `sc.exe start ${service}`);
      commands.push(sc("create", service, "binPath=", bin, "start=", "auto"), sc("start", service));
      break;
    case "uninstall":
      actions.push(`sc.exe stop ${service}`, `sc.exe delete ${service}`);
      commands.push(sc("stop", service), sc("delete", service));
      break;
    case "status":
      actions.push(`sc.exe query ${service}`);
      commands.push(sc("query", service));
      break;
    default:
      actions.push(`sc.exe ${op} ${service}`);
      commands.push(sc(op, service));
  }
  return {
    operation: op,
    manager: "windows-scm",
    commands,
    actions,
    requiresRoot: layout.scope === "system",
    readOnly: op === "status",
  };
}

/** Build a service lifecycle plan from the install manifest/layout. */
export function buildServicePlan(
  layout: InstallLayout,
  operation: ServiceOperation,
  options: BuildServicePlanOptions = {},
): ServicePlan {
  const manifest = readInstallManifest(layout) as
    | { service?: { manager?: ServiceManager; unitPath?: string } }
    | undefined;
  const manager =
    options.manager ??
    manifest?.service?.manager ??
    serviceManagerFor(layout.platform, true);
  if (manager === "none") {
    return {
      operation,
      manager,
      commands: [],
      actions: ["no service manager configured"],
      requiresRoot: false,
      readOnly: operation === "status",
    };
  }
  const unitPath = options.unitPath ?? manifest?.service?.unitPath ?? serviceUnitPath(layout, manager);
  const uid = options.uid ?? (typeof process.getuid === "function" ? process.getuid() : 0);
  if (manager === "systemd") return systemdPlan(layout, operation, unitPath ?? join(layout.configDir, "systemd", "rolecall.service"));
  if (manager === "launchd") return launchdPlan(layout, operation, unitPath ?? join(layout.configDir, "LaunchAgents", "com.rolecall.serve.plist"), uid);
  return windowsPlan(layout, operation);
}

export interface RunServiceOptions {
  dryRun?: boolean;
  /** Stop after the first nonzero command (default true). */
  stopOnError?: boolean;
  /** Injectable executor for tests. */
  run?: (cmd: ServiceCommand) => { status: number | null; stdout?: string; stderr?: string };
}

export interface RunServiceResult {
  applied: boolean;
  results: Array<{ command: ServiceCommand; status: number | null; stdout?: string; stderr?: string }>;
}

/** Execute a service plan (dry-run by default); stops on the first failure. */
export function runServicePlan(plan: ServicePlan, options: RunServiceOptions = {}): RunServiceResult {
  if (options.dryRun !== false) return { applied: false, results: [] };
  const run = options.run ?? ((cmd: ServiceCommand) => {
    const res = spawnSync(cmd.file, cmd.args, { encoding: "utf8" });
    return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
  });
  const results: RunServiceResult["results"] = [];
  for (const command of plan.commands) {
    const result = run(command);
    results.push({ command, ...result });
    if (result.status !== 0 && options.stopOnError !== false) break;
  }
  return { applied: true, results };
}
