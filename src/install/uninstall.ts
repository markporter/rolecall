// ADR 0023 uninstall plan/apply. Removes the manifest and service unit, stops
// the service when possible, and keeps config/state unless --purge. It never
// deletes the program directory or the binary.

import { existsSync, lstatSync, readlinkSync, rmSync } from "node:fs";
import { join } from "node:path";

import type { InstallLayout } from "./layout";
import { installManifestPath, readInstallManifest, serviceUnitPath, type ServiceManager } from "./plan";
import { buildServicePlan, runServicePlan, type RunServiceResult, type ServiceCommand, type ServicePlan } from "./service";

export interface UninstallPlan {
  scope: InstallLayout["scope"];
  layout: InstallLayout;
  purge: boolean;
  service: ServicePlan;
  remove: string[];
  keep: string[];
  actions: string[];
}

export interface BuildUninstallPlanOptions {
  purge?: boolean;
  manager?: ServiceManager;
  unitPath?: string;
}

/** Build the file/service actions an uninstall would take. */
export function buildUninstallPlan(layout: InstallLayout, options: BuildUninstallPlanOptions = {}): UninstallPlan {
  const manifest = readInstallManifest(layout) as
    | { service?: { manager?: ServiceManager; unitPath?: string } }
    | undefined;
  const manager = options.manager ?? manifest?.service?.manager;
  const unitPath = options.unitPath ?? manifest?.service?.unitPath ?? (manager ? serviceUnitPath(layout, manager) : undefined);
  const service = buildServicePlan(layout, "uninstall", {
    ...(manager ? { manager } : {}),
    ...(unitPath ? { unitPath } : {}),
  });
  const remove = [installManifestPath(layout), ...(unitPath ? [unitPath] : [])];
  const pathLink = join(layout.binDir, layout.platform === "win32" ? "rolecall.exe" : "rolecall");
  try {
    if (existsSync(pathLink) && lstatSync(pathLink).isSymbolicLink()) {
      const target = readlinkSync(pathLink);
      if (target.includes(layout.programDir)) remove.push(pathLink);
    }
  } catch { /* leave non-rolecall links alone */ }
  if (options.purge === true) {
    remove.push(layout.configDir, layout.stateDir, layout.cacheDir);
  }
  const keep = options.purge === true ? [] : [layout.envFile, layout.stateDir, layout.cacheDir];
  return {
    scope: layout.scope,
    layout,
    purge: options.purge === true,
    service,
    remove,
    keep,
    actions: [
      ...service.actions,
      ...remove.map((p) => `remove ${p}`),
      ...keep.map((p) => `keep ${p}`),
    ],
  };
}

export interface ApplyUninstallOptions {
  dryRun?: boolean;
  /** Injectable service executor for tests. */
  serviceRun?: (cmd: ServiceCommand) => { status: number | null; stdout?: string; stderr?: string };
}

export interface ApplyUninstallResult {
  applied: boolean;
  removed: string[];
  kept: string[];
  service: RunServiceResult["results"];
}

/** Apply an uninstall plan; dry-run by default. Service failures do not block file removal. */
export function applyUninstallPlan(plan: UninstallPlan, options: ApplyUninstallOptions = {}): ApplyUninstallResult {
  if (options.dryRun !== false) {
    return { applied: false, removed: [], kept: plan.keep, service: [] };
  }
  const service = runServicePlan(plan.service, {
    dryRun: false,
    stopOnError: false,
    ...(options.serviceRun ? { run: options.serviceRun } : {}),
  });
  const removed: string[] = [];
  for (const path of plan.remove) {
    if (!existsSync(path)) continue;
    rmSync(path, { recursive: true, force: true });
    removed.push(path);
  }
  return { applied: true, removed, kept: plan.keep.filter((p) => existsSync(p)), service: service.results };
}
