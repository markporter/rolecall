// ADR 0023 install plan: resolve layout, service manager, isolation preflight,
// and the exact actions an install would take. Planning is read-only; applying
// writes only into the resolved config/state/cache dirs and (optionally) a
// service unit file. It never installs packages or edits PATH.

import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { probeIsolation, type IsolationProbe } from "../isolation";
import { ROLECALL_VERSION } from "../util/version";
import type { InstallLayout, InstallScope } from "./layout";

export type ServiceManager = "systemd" | "launchd" | "windows-scm" | "none";

export interface InstallAction {
  kind: "create-dir" | "write-file" | "write-unit" | "warn";
  path?: string;
  description: string;
}

export interface InstallPlan {
  scope: InstallScope;
  platform: string;
  version: string;
  layout: InstallLayout;
  service: {
    manager: ServiceManager;
    enabled: boolean;
    /** System-scope service account (undefined for user installs). */
    user?: string;
    /** Unit/plist path when the platform uses a file-based manager. */
    unitPath?: string;
    /** Rendered unit/plist content for review/apply. */
    content?: string;
  };
  isolation: IsolationProbe;
  actions: InstallAction[];
  config: {
    envFile: string;
    envFileExists: boolean;
    manifestPath: string;
  };
  /** Optional versioned binary placement from --from-dir. */
  binary?: {
    version: string;
    source: string;
    target: string;
    checksumManifest: string;
    checksum: string;
    currentLink: string;
  };
}

export interface BuildInstallPlanOptions {
  layout: InstallLayout;
  /** Install a service (default true). */
  service?: boolean;
  /** Isolation backend to plan against (default auto). */
  isolationBackend?: "auto" | "namespace" | "docker" | "none";
  image?: string;
  version?: string;
  exists?: (path: string) => boolean;
  /** `--from-dir`: stage a binary from a local artifact directory. */
  fromDir?: string;
  /** System-scope service account (default rolecall). */
  serviceUser?: string;
}

export function installManifestPath(layout: InstallLayout): string {
  return join(layout.configDir, "install.json");
}

/** Platform binary name inside a version directory. */
export function programBinName(platform: string): string {
  return platform === "win32" ? "rolecall.exe" : "rolecall";
}

/** Versioned program directories (`<programDir>/versions`). */
export function versionsDir(layout: InstallLayout): string {
  return join(layout.programDir, "versions");
}

/** `current` symlink that points at the active version directory. */
export function currentLink(layout: InstallLayout): string {
  return join(layout.programDir, "current");
}

/** Executable path the service unit launches. */
export function programBinPath(layout: InstallLayout): string {
  return join(currentLink(layout), programBinName(layout.platform));
}

export function serviceManagerFor(platform: string, enabled: boolean): ServiceManager {
  if (!enabled) return "none";
  if (platform === "linux") return "systemd";
  if (platform === "darwin") return "launchd";
  if (platform === "win32") return "windows-scm";
  return "none";
}

export function serviceUnitPath(layout: InstallLayout, manager: ServiceManager): string | undefined {
  if (manager === "systemd") {
    return layout.scope === "system"
      ? "/etc/systemd/system/rolecall.service"
      : join(layout.configDir, "systemd", "rolecall.service");
  }
  if (manager === "launchd") {
    return layout.scope === "system"
      ? "/Library/LaunchDaemons/com.rolecall.serve.plist"
      : join(layout.configDir, "LaunchAgents", "com.rolecall.serve.plist");
  }
  return undefined;
}

function systemdUnit(layout: InstallLayout, serviceUser = "rolecall"): string {
  const exec = programBinPath(layout);
  const user = layout.scope === "system" ? `User=${serviceUser}\nGroup=${serviceUser}\n` : "";
  return `[Unit]
Description=RoleCall orchestrator
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
${user}ExecStart=${exec} --serve
EnvironmentFile=-${layout.envFile}
WorkingDirectory=${layout.stateDir}
StateDirectory=rolecall
CacheDirectory=rolecall
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${layout.stateDir} ${layout.cacheDir}
AmbientCapabilities=

[Install]
WantedBy=${layout.scope === "system" ? "multi-user.target" : "default.target"}
`;
}

function launchdPlist(layout: InstallLayout): string {
  const exec = programBinPath(layout);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.rolecall.serve</string>
  <key>ProgramArguments</key>
  <array>
    <string>${exec}</string>
    <string>--serve</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ROLECALL_CONFIG</key>
    <string>${layout.envFile}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${join(layout.stateDir, "serve.log")}</string>
  <key>StandardErrorPath</key>
  <string>${join(layout.stateDir, "serve.err.log")}</string>
</dict>
</plist>
`;
}

/** Read and verify a `--from-dir` artifact (version.txt + SHA256SUMS). */
export function readBinaryArtifact(layout: InstallLayout, fromDir: string): NonNullable<InstallPlan["binary"]> {
  const artifact = join(fromDir, programBinName(layout.platform));
  const versionFile = join(fromDir, "version.txt");
  const checksumManifest = join(fromDir, "SHA256SUMS");
  if (!existsSync(artifact) || !existsSync(versionFile) || !existsSync(checksumManifest)) {
    throw new Error(`--from-dir requires ${programBinName(layout.platform)}, version.txt, and SHA256SUMS`);
  }
  const version = readFileSync(versionFile, "utf8").trim();
  if (!/^[A-Za-z0-9._+-]+$/.test(version)) throw new Error(`--from-dir version.txt is invalid: '${version}'`);
  const checksum = createHash("sha256").update(readFileSync(artifact)).digest("hex");
  const lines = readFileSync(checksumManifest, "utf8").split(/\r?\n/);
  const expected = lines
    .map((line) => line.trim().split(/\s+/))
    .find((parts) => parts[parts.length - 1] === programBinName(layout.platform))?.[0];
  if (!expected) throw new Error(`--from-dir SHA256SUMS has no entry for ${programBinName(layout.platform)}`);
  if (expected.toLowerCase() !== checksum) {
    throw new Error(`--from-dir checksum mismatch for ${programBinName(layout.platform)}`);
  }
  return {
    version,
    source: artifact,
    target: join(versionsDir(layout), version, programBinName(layout.platform)),
    checksumManifest,
    checksum,
    currentLink: currentLink(layout),
  };
}

/** Copy/verify a binary and atomically switch the `current` symlink. */
export function activateBinary(
  layout: InstallLayout,
  binary: NonNullable<InstallPlan["binary"]>,
): { currentVersion: string; previousVersion?: string; written: string[] } {
  const written: string[] = [];
  const actual = createHash("sha256").update(readFileSync(binary.source)).digest("hex");
  if (actual !== binary.checksum) throw new Error("binary checksum changed after planning");
  mkdirSync(join(versionsDir(layout), binary.version), { recursive: true, mode: 0o755 });
  copyFileSync(binary.source, binary.target);
  chmodSync(binary.target, 0o755);
  written.push(binary.target);
  let previousVersion: string | undefined;
  if (existsSync(binary.currentLink)) {
    try {
      if (lstatSync(binary.currentLink).isSymbolicLink()) {
        previousVersion = readlinkSync(binary.currentLink).split(/[\/]/).filter(Boolean).pop();
      }
    } catch { /* best-effort previous pointer */ }
  }
  const tmpLink = `${binary.currentLink}.tmp-${Date.now()}`;
  try { rmSync(tmpLink, { force: true }); } catch { /* ignore */ }
  symlinkSync(join("versions", binary.version), tmpLink, "dir");
  renameSync(tmpLink, binary.currentLink);
  written.push(binary.currentLink);
  return { currentVersion: binary.version, ...(previousVersion ? { previousVersion } : {}), written };
}

/** Build a read-only install plan. */
export function buildInstallPlan(options: BuildInstallPlanOptions): InstallPlan {
  const exists = options.exists ?? existsSync;
  const layout = options.layout;
  const enabled = options.service !== false;
  const manager = serviceManagerFor(layout.platform, enabled);
  const unitPath = serviceUnitPath(layout, manager);
  const serviceUser = options.serviceUser ?? "rolecall";
  if (layout.scope === "system" && (serviceUser === "root" || serviceUser === "0")) {
    throw new Error("system service account must not be root; pass --service-user <unprivileged-account>");
  }
  const content =
    manager === "systemd"
      ? systemdUnit(layout, serviceUser)
      : manager === "launchd"
        ? launchdPlist(layout)
        : undefined;
  const isolation = probeIsolation({
    backend: options.isolationBackend ?? "auto",
    ...(options.image ? { image: options.image } : {}),
  });
  const envFileExists = exists(layout.envFile);

  let binary: InstallPlan["binary"];
  if (options.fromDir) binary = readBinaryArtifact(layout, options.fromDir);

  const actions: InstallAction[] = [
    { kind: "create-dir", path: layout.configDir, description: `create config dir ${layout.configDir}` },
    { kind: "create-dir", path: layout.stateDir, description: `create state dir ${layout.stateDir}` },
    { kind: "create-dir", path: layout.cacheDir, description: `create cache dir ${layout.cacheDir}` },
  ];
  if (binary) {
    actions.push(
      { kind: "write-file", path: binary.target, description: `install binary ${binary.target} (v${binary.version})` },
      { kind: "write-file", path: binary.currentLink, description: `switch ${binary.currentLink} -> versions/${binary.version}` },
    );
  }
  if (!exists(layout.programDir)) {
    actions.push({
      kind: "warn",
      path: layout.programDir,
      description: `program dir ${layout.programDir} does not exist; the bootstrap or package must place the binary there`,
    });
  }
  if (!envFileExists) {
    actions.push({
      kind: "write-file",
      path: layout.envFile,
      description: `create ${layout.envFile} (0600 user / 0640 system)`,
    });
  }
  actions.push({
    kind: "write-file",
    path: installManifestPath(layout),
    description: `write install manifest ${installManifestPath(layout)}`,
  });
  if (unitPath && content) {
    actions.push({ kind: "write-unit", path: unitPath, description: `write ${manager} unit ${unitPath}` });
  }
  if (isolation.selected === "none") {
    actions.push({
      kind: "warn",
      description: "no isolation backend detected; local execution would fail closed (install bwrap or Docker)",
    });
  }

  return {
    scope: layout.scope,
    platform: layout.platform,
    version: options.version ?? ROLECALL_VERSION,
    layout,
    service: {
      manager,
      enabled,
      ...(layout.scope === "system" ? { user: serviceUser } : {}),
      ...(unitPath ? { unitPath } : {}),
      ...(content ? { content } : {}),
    },
    isolation,
    actions,
    config: {
      envFile: layout.envFile,
      envFileExists,
      manifestPath: installManifestPath(layout),
    },
    ...(binary ? { binary } : {}),
  };
}

export interface ApplyInstallOptions {
  dryRun?: boolean;
  force?: boolean;
}

export interface ApplyInstallResult {
  applied: boolean;
  written: string[];
  warnings: string[];
}

/** Apply a plan. Never creates the program dir or installs/enables a service. */
export function applyInstallPlan(plan: InstallPlan, options: ApplyInstallOptions = {}): ApplyInstallResult {
  const dryRun = options.dryRun !== false;
  const written: string[] = [];
  const warnings = plan.actions.filter((a) => a.kind === "warn").map((a) => a.description);
  if (dryRun) return { applied: false, written, warnings };

  const dirs = [plan.layout.configDir, plan.layout.stateDir, plan.layout.cacheDir];
  for (const dir of dirs) mkdirSync(dir, { recursive: true, mode: 0o755 });

  if (!existsSync(plan.layout.envFile) || options.force === true) {
    const body = [
      "# RoleCall runtime configuration (KEY=VALUE).",
      "# Process environment and CLI flags override these values.",
      "# ROLECALL_SERVE_PORT=8080",
      "# ROLECALL_SERVE_HOST=127.0.0.1",
      "",
    ].join("\n");
    writeFileSync(plan.layout.envFile, body, { mode: plan.scope === "user" ? 0o600 : 0o640 });
    chmodSync(plan.layout.envFile, plan.scope === "user" ? 0o600 : 0o640);
    written.push(plan.layout.envFile);
  }

  let currentVersion: string | undefined;
  let previousVersion: string | undefined;
  if (plan.binary) {
    const activated = activateBinary(plan.layout, plan.binary);
    currentVersion = activated.currentVersion;
    previousVersion = activated.previousVersion;
    written.push(...activated.written);
  }

  const manifest = {
    schemaVersion: 1,
    scope: plan.scope,
    version: plan.version,
    runtime: "embedded",
    platform: plan.platform,
    ...(currentVersion ? { currentVersion } : {}),
    ...(previousVersion ? { previousVersion } : {}),
    paths: {
      programDir: plan.layout.programDir,
      configDir: plan.layout.configDir,
      stateDir: plan.layout.stateDir,
      cacheDir: plan.layout.cacheDir,
      binDir: plan.layout.binDir,
      envFile: plan.layout.envFile,
    },
    service: {
      manager: plan.service.manager,
      enabled: plan.service.enabled,
      ...(plan.service.user ? { user: plan.service.user } : {}),
      ...(plan.service.unitPath ? { unitPath: plan.service.unitPath } : {}),
    },
    installedAt: new Date().toISOString(),
  };
  writeFileSync(plan.config.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  written.push(plan.config.manifestPath);

  if (plan.service.unitPath && plan.service.content) {
    mkdirSync(plan.service.unitPath.replace(/\/[^/]+$/, ""), { recursive: true, mode: 0o755 });
    writeFileSync(plan.service.unitPath, plan.service.content, { mode: 0o644 });
    written.push(plan.service.unitPath);
  }
  return { applied: true, written, warnings };
}

/** Read the install manifest if present (used by doctor/service later). */
export function readInstallManifest(layout: InstallLayout): Record<string, unknown> | undefined {
  const path = installManifestPath(layout);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
