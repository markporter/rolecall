// ADR 0023 update/rollback (local --from-dir slice).
//
// Network/channel discovery is not implemented; updates stage a verified artifact
// from --from-dir. Versions live under <programDir>/versions/<version> and the
// current symlink switches atomically. The service restarts unless --no-restart.

import { copyFileSync, existsSync, lstatSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import type { InstallLayout } from "./layout";
import {
  activateBinary,
  installManifestPath,
  programBinName,
  readBinaryArtifact,
  readInstallManifest,
  versionsDir,
  type InstallPlan,
} from "./plan";
import { buildServicePlan, runServicePlan, type RunServiceResult, type ServiceCommand } from "./service";

export interface UpdateCheck {
  currentVersion?: string;
  currentLink: string;
  candidateVersion?: string;
  updateAvailable: boolean;
  warnings: string[];
}

export interface UpdatePlan {
  operation: "update" | "rollback";
  fromVersion?: string;
  toVersion?: string;
  binary?: NonNullable<InstallPlan["binary"]>;
  restart: boolean;
  actions: string[];
}

export interface BuildUpdatePlanOptions {
  fromDir?: string;
  rollback?: boolean;
  restart?: boolean;
}

function symlinkVersion(layout: InstallLayout): string | undefined {
  const link = join(layout.programDir, "current");
  try {
    if (!lstatSync(link).isSymbolicLink()) return undefined;
    return readlinkSync(link).split(/[\\/]/).filter(Boolean).pop();
  } catch {
    return undefined;
  }
}

/** Read-only update check; a candidate is reported only when --from-dir is supplied. */
export function checkUpdate(layout: InstallLayout, fromDir?: string): UpdateCheck {
  const manifest = readInstallManifest(layout) as { currentVersion?: string } | undefined;
  const currentVersion = manifest?.currentVersion ?? symlinkVersion(layout);
  const warnings: string[] = [];
  let candidateVersion: string | undefined;
  if (fromDir) {
    try {
      candidateVersion = readBinaryArtifact(layout, fromDir).version;
    } catch (err) {
      warnings.push(err instanceof Error ? err.message : String(err));
    }
  } else {
    warnings.push("network/channel update discovery is not implemented; pass --from-dir");
  }
  return {
    currentVersion,
    currentLink: join(layout.programDir, "current"),
    ...(candidateVersion ? { candidateVersion } : {}),
    updateAvailable: Boolean(candidateVersion && candidateVersion !== currentVersion),
    warnings,
  };
}

/** Build an update/rollback plan. */
export function buildUpdatePlan(layout: InstallLayout, options: BuildUpdatePlanOptions = {}): UpdatePlan {
  const manifest = readInstallManifest(layout) as
    | { currentVersion?: string; previousVersion?: string }
    | undefined;
  const current = manifest?.currentVersion ?? symlinkVersion(layout);
  if (options.rollback === true) {
    const previous = manifest?.previousVersion;
    if (!previous) throw new Error("no previous version recorded for rollback");
    const bin = join(versionsDir(layout), previous, programBinName(layout.platform));
    if (!existsSync(bin)) throw new Error(`rollback version ${previous} is no longer installed`);
    return {
      operation: "rollback",
      fromVersion: current,
      toVersion: previous,
      restart: options.restart !== false,
      actions: [`switch current -> versions/${previous}`, ...(options.restart !== false ? ["restart service"] : [])],
    };
  }
  if (!options.fromDir) throw new Error("update requires --from-dir (network/channel discovery is not implemented)");
  const binary = readBinaryArtifact(layout, options.fromDir);
  return {
    operation: "update",
    fromVersion: current,
    toVersion: binary.version,
    binary,
    restart: options.restart !== false,
    actions: [
      `install versions/${binary.version}`,
      `switch current -> versions/${binary.version}`,
      ...(options.restart !== false ? ["restart service"] : []),
    ],
  };
}

export interface ApplyUpdateOptions {
  dryRun?: boolean;
  restart?: boolean;
  serviceRun?: (cmd: ServiceCommand) => { status: number | null; stdout?: string; stderr?: string };
}

export interface ApplyUpdateResult {
  applied: boolean;
  fromVersion?: string;
  toVersion?: string;
  written: string[];
  service: RunServiceResult["results"];
  /** Backup path of the state DB taken before the swap. */
  backup?: string;
  /** True when a failed restart forced a switch back to the previous version. */
  rolledBack?: boolean;
}

/** Switch the current symlink to a version directory. */
function switchCurrent(layout: InstallLayout, version: string): string {
  const link = join(layout.programDir, "current");
  const tmp = `${link}.tmp-${Date.now()}`;
  try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
  symlinkSync(join("versions", version), tmp, "dir");
  renameSync(tmp, link);
  return link;
}

/** Best-effort SQLite backup before a version swap (main DB + WAL/SHM sidecars). */
function backupRegistry(layout: InstallLayout): string | undefined {
  const db = join(layout.stateDir, "state.db");
  if (!existsSync(db)) return undefined;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${db}.bak-${stamp}`;
  copyFileSync(db, backup);
  for (const suffix of ["-wal", "-shm"]) {
    if (existsSync(`${db}${suffix}`)) copyFileSync(`${db}${suffix}`, `${backup}${suffix}`);
  }
  return backup;
}

/** Run `<newbin> --version` as a smoke check before swapping. */
function smokeBinary(binary: NonNullable<UpdatePlan["binary"]>): void {
  const res = spawnSync(binary.source, ["--version"], { encoding: "utf8", timeout: 15_000 });
  if (res.error) throw new Error(`new binary smoke check failed: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`new binary --version failed (exit ${res.status ?? "?"})`);
  const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  if (!output.includes(binary.version)) {
    throw new Error(`new binary reported an unexpected version: ${output.trim() || "(empty)"}`);
  }
}

function writeManifest(layout: InstallLayout, patch: Record<string, unknown>): string {
  const path = installManifestPath(layout);
  let existing: Record<string, unknown> = {};
  try { existing = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>; } catch { /* new */ }
  const next = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o644 });
  return path;
}

/** Apply an update/rollback plan (dry-run by default). */
export function applyUpdatePlan(
  layout: InstallLayout,
  plan: UpdatePlan,
  options: ApplyUpdateOptions = {},
): ApplyUpdateResult {
  if (options.dryRun !== false) {
    return { applied: false, fromVersion: plan.fromVersion, toVersion: plan.toVersion, written: [], service: [] };
  }
  const written: string[] = [];
  let previousVersion = plan.fromVersion;
  const backup = backupRegistry(layout);
  if (backup) written.push(backup);
  if (plan.operation === "rollback") {
    if (!plan.toVersion) throw new Error("rollback requires a target version");
    const bin = join(versionsDir(layout), plan.toVersion, programBinName(layout.platform));
    if (!existsSync(bin)) throw new Error(`rollback version ${plan.toVersion} is no longer installed`);
    written.push(switchCurrent(layout, plan.toVersion));
  } else {
    if (!plan.binary) throw new Error("update plan has no binary");
    smokeBinary(plan.binary);
    const activated = activateBinary(layout, plan.binary);
    previousVersion = activated.previousVersion;
    written.push(...activated.written);
  }
  written.push(writeManifest(layout, {
    currentVersion: plan.toVersion,
    ...(previousVersion ? { previousVersion } : {}),
  }));

  let service: RunServiceResult["results"] = [];
  if (options.restart !== false && plan.restart) {
    const servicePlan = buildServicePlan(layout, "restart");
    service = runServicePlan(servicePlan, {
      dryRun: false,
      stopOnError: false,
      ...(options.serviceRun ? { run: options.serviceRun } : {}),
    }).results;
    const failed = service.some((r) => r.status !== 0);
    if (failed && previousVersion) {
      written.push(switchCurrent(layout, previousVersion));
      written.push(writeManifest(layout, {
        currentVersion: previousVersion,
        previousVersion: plan.toVersion,
      }));
      const rollbackService = buildServicePlan(layout, "restart");
      const rollbackResults = runServicePlan(rollbackService, {
        dryRun: false,
        stopOnError: false,
        ...(options.serviceRun ? { run: options.serviceRun } : {}),
      }).results;
      return {
        applied: true,
        fromVersion: plan.fromVersion,
        toVersion: previousVersion,
        written,
        service: [...service, ...rollbackResults],
        ...(backup ? { backup } : {}),
        rolledBack: true,
      };
    }
  }
  return { applied: true, fromVersion: plan.fromVersion, toVersion: plan.toVersion, written, service, ...(backup ? { backup } : {}) };
}
