// ADR 0023 install plan: resolve layout, service manager, isolation preflight,
// and the exact actions an install would take. Planning is read-only; applying
// writes only into the resolved config/state/cache dirs and (optionally) a
// service unit file. It never installs packages or edits PATH.

import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";

import { probeIsolation, type IsolationProbe } from "../isolation";
import { ROLECALL_VERSION } from "../util/version";
import { readEnvFile } from "./env-file";
import { bunRuntimeBin, bunRuntimeDir, embeddedBunVersion } from "./runtime";
import type { InstallLayout, InstallScope } from "./layout";

export type ServiceManager = "systemd" | "launchd" | "windows-scm" | "none";
/** How this RoleCall installation is managed. */
export type InstallKind = "binary" | "npm" | "bun-global" | "os-package" | "source";

export interface InstallAction {
  kind: "create-dir" | "write-file" | "write-unit" | "warn";
  path?: string;
  description: string;
}

export interface InstallPlan {
  scope: InstallScope;
  platform: string;
  version: string;
  kind: InstallKind;
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
  /** ADR 0023/0027 serve exposure settings written to rolecall.env. */
  serve: {
    host: string;
    exposed: boolean;
    /** Token to write; omitted when one already exists (never echoed back). */
    token?: string;
    /** True when this plan generated a new token that must be shown once. */
    tokenGenerated: boolean;
  };
  /** Embedded runtime or the optional standalone Bun toolchain. */
  runtime:
    | { kind: "embedded"; version?: string }
    | { kind: "bun"; version: string; dir: string; bin: string };
  /** Optional binDir/rolecall -> current/rolecall symlink. */
  pathLink?: { path: string; target: string };
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
  /** Install kind recorded in the manifest (default binary). */
  kind?: InstallKind;
  /** Add the binDir/rolecall symlink (default true). */
  addToPath?: boolean;
  /** Enable the ADR 0027 exposed serve profile. */
  exposed?: boolean;
  /** Listen host recorded in rolecall.env (default 127.0.0.1). */
  serveHost?: string;
  /** Explicit Bearer token; generated when exposed and omitted. */
  serveToken?: string;
  /** Install the optional standalone Bun toolchain (ADR 0023 §5). */
  withBun?: boolean;
  /** Pinned Bun version; required when withBun is true. */
  bunVersion?: string;
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

function systemdUnit(layout: InstallLayout, serviceUser = "rolecall", exposed = false): string {
  const exec = programBinPath(layout);
  const user = layout.scope === "system" ? `User=${serviceUser}\nGroup=${serviceUser}\n` : "";
  const execArgs = exposed ? " --serve --exposed" : " --serve";
  return `[Unit]
Description=RoleCall orchestrator
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
${user}ExecStart=${exec}${execArgs}
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

function launchdPlist(layout: InstallLayout, exposed = false): string {
  const exec = programBinPath(layout);
  const exposedArg = exposed ? "\n    <string>--exposed</string>" : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.rolecall.serve</string>
  <key>ProgramArguments</key>
  <array>
    <string>${exec}</string>
    <string>--serve</string>${exposedArg}
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
  const exposed = options.exposed === true;
  const serveHost = options.serveHost ?? "127.0.0.1";
  const content =
    manager === "systemd"
      ? systemdUnit(layout, serviceUser, exposed)
      : manager === "launchd"
        ? launchdPlist(layout, exposed)
        : undefined;
  const isolation = probeIsolation({
    backend: options.isolationBackend ?? "auto",
    ...(options.image ? { image: options.image } : {}),
  });
  const envFileExists = exists(layout.envFile);

  let serveToken = options.serveToken;
  let tokenGenerated = false;
  // ADR 0023 §9: a system service install always provisions a token so a later
  // non-loopback bind cannot accidentally run unauthenticated.
  const wantsToken = exposed || (enabled && layout.scope === "system");
  if (wantsToken && !serveToken) {
    const existing = envFileExists ? readEnvFile(layout.envFile)["ROLECALL_SERVE_TOKEN"] : undefined;
    if (!existing) {
      serveToken = randomBytes(32).toString("base64url");
      tokenGenerated = true;
    }
  }

  let runtime: InstallPlan["runtime"];
  if (options.withBun === true) {
    if (!options.bunVersion) throw new Error("--with-bun requires a resolved --bun-version");
    runtime = {
      kind: "bun",
      version: options.bunVersion,
      dir: bunRuntimeDir(layout, options.bunVersion),
      bin: bunRuntimeBin(layout, options.bunVersion),
    };
  } else {
    runtime = { kind: "embedded", ...(embeddedBunVersion() ? { version: embeddedBunVersion() } : {}) };
  }

  let binary: InstallPlan["binary"];
  if (options.fromDir) binary = readBinaryArtifact(layout, options.fromDir);

  const actions: InstallAction[] = [
    { kind: "create-dir", path: layout.configDir, description: `create config dir ${layout.configDir}` },
    { kind: "create-dir", path: layout.stateDir, description: `create state dir ${layout.stateDir}` },
    { kind: "create-dir", path: layout.cacheDir, description: `create cache dir ${layout.cacheDir}` },
  ];
  const pathLink = options.addToPath === false
    ? undefined
    : { path: join(layout.binDir, programBinName(layout.platform)), target: programBinPath(layout) };
  if (pathLink) {
    actions.push({ kind: "write-file", path: pathLink.path, description: `link ${pathLink.path} -> ${pathLink.target}` });
  }
  if (binary) {
    actions.push(
      { kind: "write-file", path: binary.target, description: `install binary ${binary.target} (v${binary.version})` },
      { kind: "write-file", path: binary.currentLink, description: `switch ${binary.currentLink} -> versions/${binary.version}` },
    );
  }
  if (runtime.kind === "bun") {
    actions.push({ kind: "write-file", path: runtime.bin, description: `install Bun ${runtime.version} at ${runtime.bin}` });
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
  if (envFileExists && (exposed || tokenGenerated)) {
    actions.push({
      kind: "write-file",
      path: layout.envFile,
      description: tokenGenerated
        ? `add generated ROLECALL_SERVE_TOKEN${exposed ? " and exposure settings" : ""} to ${layout.envFile}`
        : `ensure exposure settings in ${layout.envFile}`,
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
    kind: options.kind ?? "binary",
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
    serve: {
      host: serveHost,
      exposed,
      ...(serveToken ? { token: serveToken } : {}),
      tokenGenerated,
    },
    runtime,
    ...(binary ? { binary } : {}),
    ...(pathLink ? { pathLink } : {}),
  };
}

/** Insert or replace KEY=VALUE lines while preserving comments and unknown keys. */
function upsertEnvLines(existing: string, entries: Record<string, string>): string {
  const lines = existing.length > 0 ? existing.split(/\r?\n/) : [];
  for (const [key, value] of Object.entries(entries)) {
    const re = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
    const index = lines.findIndex((line) => re.test(line));
    if (index >= 0) lines[index] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
  }
  let body = lines.join("\n");
  if (!body.endsWith("\n")) body += "\n";
  return body;
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

  const serveEntries: Record<string, string> = {};
  if (plan.serve.exposed) {
    serveEntries["ROLECALL_SERVE_EXPOSED"] = "1";
    serveEntries["ROLECALL_SERVE_HOST"] = plan.serve.host;
  }
  // --force rewrites the file; never drop a token that the plan deliberately
  // did not echo back.
  const existingToken = existsSync(plan.layout.envFile)
    ? readEnvFile(plan.layout.envFile)["ROLECALL_SERVE_TOKEN"]
    : undefined;
  const serveToken = plan.serve.token ?? existingToken;
  if (serveToken) serveEntries["ROLECALL_SERVE_TOKEN"] = serveToken;
  if (!existsSync(plan.layout.envFile) || options.force === true) {
    const body = upsertEnvLines([
      "# RoleCall runtime configuration (KEY=VALUE).",
      "# Process environment and CLI flags override these values.",
      "# ROLECALL_SERVE_PORT=8080",
      "# ROLECALL_SERVE_HOST=127.0.0.1",
      "",
    ].join("\n"), serveEntries);
    writeFileSync(plan.layout.envFile, body, { mode: plan.scope === "user" ? 0o600 : 0o640 });
    chmodSync(plan.layout.envFile, plan.scope === "user" ? 0o600 : 0o640);
    written.push(plan.layout.envFile);
  } else if (Object.keys(serveEntries).length > 0) {
    const current = readFileSync(plan.layout.envFile, "utf8");
    const merged = upsertEnvLines(current, serveEntries);
    if (merged !== current) {
      writeFileSync(plan.layout.envFile, merged, { mode: plan.scope === "user" ? 0o600 : 0o640 });
      written.push(plan.layout.envFile);
    }
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
    runtime: plan.runtime.kind === "bun" ? plan.runtime.version : "embedded",
    ...(plan.runtime.kind === "bun" ? { runtimePath: plan.runtime.bin } : {}),
    kind: plan.kind,
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

  if (plan.pathLink) {
    mkdirSync(plan.pathLink.path.replace(/\/[^/]+$/, ""), { recursive: true, mode: 0o755 });
    let replace = true;
    try {
      if (lstatSync(plan.pathLink.path).isSymbolicLink() && readlinkSync(plan.pathLink.path) === plan.pathLink.target) {
        replace = false;
      }
    } catch { /* missing is fine */ }
    if (replace && (existsSync(plan.pathLink.path) || lstatSync(plan.pathLink.path, { throwIfNoEntry: false }))) {
      if (options.force !== true) {
        warnings.push(`PATH link ${plan.pathLink.path} already exists; rerun with --force to replace it`);
        return { applied: true, written, warnings };
      }
      rmSync(plan.pathLink.path, { force: true });
    }
    if (replace) {
      symlinkSync(plan.pathLink.target, plan.pathLink.path);
      written.push(plan.pathLink.path);
    }
  }
  return { applied: true, written, warnings };
}

/** Patch the install manifest when it exists; returns the updated object (or undefined). */
export function updateInstallManifest(
  layout: InstallLayout,
  patch: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const current = readInstallManifest(layout);
  if (!current) return undefined;
  const next = { ...current, ...patch };
  writeFileSync(installManifestPath(layout), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o644 });
  return next;
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
