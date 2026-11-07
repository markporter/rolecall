// `rolecall update` — ADR 0023/0029 versioned update/rollback.
//
// `--check` is read-only. Applying stages a verified binary (network discovery or
// --from-dir), atomically switches the current symlink, updates the manifest, and
// restarts the service unless --no-restart.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveInstallLayout } from "../../install/layout";
import { applyUpdatePlan, buildUpdatePlan, checkUpdate, type UpdatePlan } from "../../install/update";
import { checkForUpdate, downloadReleaseArtifact } from "../../install/release";
import { currentLink, programBinName, readInstallManifest, versionsDir } from "../../install/plan";
import { detectInstallKind, packageManagerUpdateCommand } from "../../install/kind";
import { spawnSync } from "node:child_process";
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

  if (flags.offline === true && !flags.fromDir && flags.rollback !== true) {
    throw new CliError(true, "--offline requires --from-dir or --rollback");
  }
  const manifest = readInstallManifest(layout) as { kind?: import("../../install/plan").InstallKind } | undefined;
  const kind = detectInstallKind(manifest?.kind);
  if (flags.check === true) {
    if (flags.fromDir) {
      const check = checkUpdate(layout, flags.fromDir);
      return { command: "update", check, applied: false, written: [], service: [] };
    }
    const current = checkUpdate(layout).currentVersion;
    const candidate = await checkForUpdate({ ...(current ? { currentVersion: current } : {}), ...(flags.updateUrl ? { updateUrl: flags.updateUrl } : {}) });
    return {
      command: "update",
      check: {
        currentVersion: candidate.currentVersion,
        currentLink: join(layout.programDir, "current"),
        candidateVersion: candidate.manifest.version,
        updateAvailable: candidate.updateAvailable,
        warnings: [],
      },
      applied: false,
      written: [],
      service: [],
    };
  }

  const dryRun = flags.dryRun === true || flags.yes !== true;
  if (!dryRun && scope === "system" && !root) {
    throw new CliError(true, "system-scope update requires root/Administrator");
  }

  if (kind !== "binary") {
    if (flags.rollback) throw new CliError(true, "rollback is only supported for binary installs");
    if (kind === "os-package") {
      throw new CliError(false, "this RoleCall was installed by an OS package; use apt/dnf/brew/MSI to update it");
    }
    if (kind === "source") {
      throw new CliError(false, "this is a source checkout; update it with git and rebuild");
    }
    const current = checkUpdate(layout).currentVersion;
    const candidate = await checkForUpdate({ ...(current ? { currentVersion: current } : {}), ...(flags.updateUrl ? { updateUrl: flags.updateUrl } : {}) });
    const command = packageManagerUpdateCommand(kind, candidate.manifest.version);
    if (!command) throw new CliError(false, `no package-manager update path for install kind '${kind}'`);
    let applied = false;
    if (!dryRun) {
      const res = spawnSync(command.file, command.args, { stdio: "inherit" });
      if (res.error) throw new CliError(false, `package-manager update failed: ${res.error.message}`);
      applied = res.status === 0;
    }
    return {
      command: "update",
      applied,
      toVersion: candidate.manifest.version,
      written: [],
      service: [],
      delegated: command,
    };
  }

  let plan: UpdatePlan;
  let cleanup: (() => void) | undefined;
  if (flags.fromDir || flags.rollback === true) {
    plan = buildUpdatePlan(layout, {
      ...(flags.fromDir ? { fromDir: flags.fromDir } : {}),
      rollback: flags.rollback === true,
      restart: flags.noRestart !== true,
    });
  } else {
    const current = checkUpdate(layout).currentVersion;
    const candidate = await checkForUpdate({ ...(current ? { currentVersion: current } : {}), ...(flags.updateUrl ? { updateUrl: flags.updateUrl } : {}) });
    if (!candidate.updateAvailable && flags.force !== true) {
      throw new CliError(false, `already up to date (${candidate.manifest.version})`);
    }
    if (dryRun) {
      plan = {
        operation: "update",
        ...(current ? { fromVersion: current } : {}),
        toVersion: candidate.manifest.version,
        restart: flags.noRestart !== true,
        actions: [
          `download ${candidate.artifactKey} from ${candidate.source}`,
          `install versions/${candidate.manifest.version}`,
          `switch current -> versions/${candidate.manifest.version}`,
          ...(flags.noRestart !== true ? ["restart service"] : []),
        ],
      };
    } else {
      const dir = mkdtempSync(join(tmpdir(), "rolecall-update-"));
      cleanup = () => rmSync(dir, { recursive: true, force: true });
      const downloaded = join(dir, programBinName(layout.platform));
      await downloadReleaseArtifact(candidate, downloaded);
      plan = {
        operation: "update",
        ...(current ? { fromVersion: current } : {}),
        toVersion: candidate.manifest.version,
        binary: {
          version: candidate.manifest.version,
          source: downloaded,
          target: join(versionsDir(layout), candidate.manifest.version, programBinName(layout.platform)),
          checksumManifest: "",
          checksum: candidate.artifact.sha256,
          currentLink: currentLink(layout),
        },
        restart: flags.noRestart !== true,
        actions: [`install versions/${candidate.manifest.version}`, `switch current -> versions/${candidate.manifest.version}`],
      };
    }
  }

  try {
    const result = applyUpdatePlan(layout, plan, { dryRun, restart: flags.noRestart !== true });
    return {
      command: "update",
      plan,
      applied: result.applied,
      ...(result.fromVersion ? { fromVersion: result.fromVersion } : {}),
      ...(result.toVersion ? { toVersion: result.toVersion } : {}),
      written: result.written,
      service: result.service,
      ...(result.backup ? { backup: result.backup } : {}),
      ...(result.rolledBack ? { rolledBack: true } : {}),
    };
  } finally {
    cleanup?.();
  }
}
