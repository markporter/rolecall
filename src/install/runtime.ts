// ADR 0023 §5: optional standalone Bun toolchain.
//
// The native binary already embeds Bun, so this is opt-in (`--with-bun` /
// `rolecall runtime install`). The toolchain lives under
// <programDir>/runtime/bun/<version>/ and is never added to PATH unless
// `--add-bun-to-path` is given.

import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { InstallLayout } from "./layout";
import { compareSemver, type FetchLike } from "./release";

export interface BunRuntimeStatus {
  kind: "embedded" | "external";
  /** Bun version embedded in the running RoleCall binary (undefined on Node). */
  embeddedVersion?: string;
  /** External toolchain version, when installed. */
  version?: string;
  path?: string;
  /** All versions found under runtime/bun. */
  installed: string[];
  programDir: string;
  root: string;
}

export interface InstallBunOptions {
  /** Version to install; resolved from --from-dir/version.txt or the network when omitted. */
  version?: string;
  /** Local artifact directory containing bun[.exe] + version.txt (+ optional SHA256SUMS). */
  fromDir?: string;
  /** Add a binDir/bun symlink to the installed toolchain. */
  addToPath?: boolean;
  /** Plan only (default true). */
  dryRun?: boolean;
  fetchImpl?: FetchLike;
  platform?: string;
  arch?: string;
}

export interface InstallBunResult {
  version: string;
  dir: string;
  bin: string;
  source: "local" | "network";
  dryRun: boolean;
  written: string[];
  pathLink?: string;
}

export function bunRuntimeRoot(layout: InstallLayout): string {
  return join(layout.programDir, "runtime", "bun");
}

export function bunRuntimeDir(layout: InstallLayout, version: string): string {
  return join(bunRuntimeRoot(layout), version);
}

export function bunBinName(platform: string): string {
  return platform === "win32" ? "bun.exe" : "bun";
}

export function bunRuntimeBin(layout: InstallLayout, version: string): string {
  return join(bunRuntimeDir(layout, version), bunBinName(layout.platform));
}

/** Bun version embedded in the running binary (undefined on the Node channel). */
export function embeddedBunVersion(): string | undefined {
  return process.versions.bun;
}

/** Versions currently installed under runtime/bun, sorted ascending. */
export function listInstalledBunVersions(layout: InstallLayout): string[] {
  const root = bunRuntimeRoot(layout);
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => existsSync(bunRuntimeBin(layout, name)))
      .sort(compareSemver);
  } catch {
    return [];
  }
}

/** Report the effective runtime: an external toolchain when installed, else embedded. */
export function runtimeStatus(layout: InstallLayout, manifestRuntime?: unknown): BunRuntimeStatus {
  const installed = listInstalledBunVersions(layout);
  const manifestVersion = typeof manifestRuntime === "string" && manifestRuntime !== "embedded"
    ? manifestRuntime
    : undefined;
  const version = manifestVersion && installed.includes(manifestVersion)
    ? manifestVersion
    : installed[installed.length - 1];
  if (version) {
    return {
      kind: "external",
      version,
      path: bunRuntimeBin(layout, version),
      installed,
      programDir: layout.programDir,
      root: bunRuntimeRoot(layout),
    };
  }
  return {
    kind: "embedded",
    ...(embeddedBunVersion() ? { embeddedVersion: embeddedBunVersion() } : {}),
    installed,
    programDir: layout.programDir,
    root: bunRuntimeRoot(layout),
  };
}

/** Bun release asset name for a platform/arch pair. */
export function bunAssetName(platform: string, arch: string): string {
  if (platform === "linux") return arch === "arm64" ? "bun-linux-aarch64.zip" : "bun-linux-x64.zip";
  if (platform === "darwin") return arch === "arm64" ? "bun-darwin-aarch64.zip" : "bun-darwin-x64.zip";
  if (platform === "win32") return "bun-windows-x64.zip";
  return `bun-${platform}-${arch}.zip`;
}

/** GitHub release download URL for a Bun asset. */
export function bunReleaseUrl(version: string, asset: string): string {
  return `https://github.com/oven-sh/bun/releases/download/bun-v${version}/${asset}`;
}

/** Read a local artifact's version.txt (accepts a bun/ subdirectory). */
export function readLocalBunVersion(fromDir: string): string {
  const dir = localArtifactDir(fromDir);
  const file = join(dir, "version.txt");
  if (!existsSync(file)) {
    throw new Error(`Bun artifact ${dir} is missing version.txt (or pass --bun-version)`);
  }
  const version = readFileSync(file, "utf8").trim();
  if (!/^[A-Za-z0-9._+-]+$/.test(version)) throw new Error(`Bun version.txt is invalid: '${version}'`);
  return version;
}

/** True when a directory contains a local Bun artifact (bun[.exe] + version.txt). */
export function hasLocalBun(fromDir: string): boolean {
  const dir = localArtifactDir(fromDir);
  return existsSync(join(dir, "version.txt")) && (existsSync(join(dir, "bun")) || existsSync(join(dir, "bun.exe")));
}

function localArtifactDir(fromDir: string): string {
  const nested = join(fromDir, "bun");
  try {
    if (statSync(nested).isDirectory()) return nested;
  } catch { /* no nested artifact dir */ }
  return fromDir;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function expectedChecksum(dir: string, name: string): string | undefined {
  const file = join(dir, "SHA256SUMS");
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((raw) => raw.trim().split(/\s+/))
    .find((parts) => parts[parts.length - 1] === name);
  return line?.[0]?.toLowerCase();
}

/** Discover the latest Bun release version from GitHub. */
export async function resolveLatestBunVersion(fetchImpl: FetchLike = fetch): Promise<string> {
  const res = await fetchImpl("https://api.github.com/repos/oven-sh/bun/releases/latest", {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "rolecall-runtime" },
  });
  if (!res.ok) throw new Error(`Bun release discovery failed: HTTP ${res.status}`);
  const body = (await res.json()) as { tag_name?: unknown };
  const tag = typeof body.tag_name === "string" ? body.tag_name : "";
  const match = tag.match(/^bun-v?(.+)$/);
  if (!match?.[1]) throw new Error(`unexpected Bun release tag '${tag}'`);
  return match[1];
}

function findBinary(dir: string, name: string): string | undefined {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isFile() && entry.name === name) return path;
    if (entry.isDirectory()) {
      const found = findBinary(path, name);
      if (found) return found;
    }
  }
  return undefined;
}

function extractZip(zip: string, dest: string): void {
  const attempts: Array<[string, string[]]> = process.platform === "win32"
    ? [["tar", ["-xf", zip, "-C", dest]]]
    : [["unzip", ["-q", zip, "-d", dest]], ["tar", ["-xf", zip, "-C", dest]]];
  for (const [file, args] of attempts) {
    const result = spawnSync(file, args, { encoding: "utf8" });
    if (result.status === 0) return;
  }
  throw new Error("could not extract the Bun archive (install unzip or tar)");
}

async function downloadBun(
  version: string,
  targetBin: string,
  options: InstallBunOptions,
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const asset = bunAssetName(platform, arch);
  const sumsRes = await fetchImpl(bunReleaseUrl(version, "SHASUMS256.txt"), {
    headers: { "User-Agent": "rolecall-runtime" },
  });
  if (!sumsRes.ok) throw new Error(`Bun checksum download failed: HTTP ${sumsRes.status}`);
  const expected = (await sumsRes.text())
    .split(/\r?\n/)
    .map((raw) => raw.trim().split(/\s+/))
    .find((parts) => parts[parts.length - 1] === asset)?.[0]?.toLowerCase();
  if (!expected) throw new Error(`Bun release ${version} has no checksum for ${asset}`);

  const zipRes = await fetchImpl(bunReleaseUrl(version, asset), {
    headers: { "User-Agent": "rolecall-runtime" },
  });
  if (!zipRes.ok) throw new Error(`Bun artifact download failed: HTTP ${zipRes.status}`);
  const bytes = Buffer.from(await zipRes.arrayBuffer());
  if (sha256(bytes) !== expected) throw new Error("Bun artifact SHA-256 mismatch");

  const work = mkdtempSync(join(tmpdir(), "rolecall-bun-"));
  try {
    const zip = join(work, asset);
    writeFileSync(zip, bytes);
    const extracted = join(work, "extracted");
    mkdirSync(extracted, { recursive: true, mode: 0o755 });
    extractZip(zip, extracted);
    const found = findBinary(extracted, bunBinName(platform));
    if (!found) throw new Error(`Bun archive ${asset} did not contain ${bunBinName(platform)}`);
    copyFileSync(found, targetBin);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function copyLocalBun(fromDir: string, targetBin: string, version: string, platform: string): void {
  const dir = localArtifactDir(fromDir);
  const name = bunBinName(platform);
  const source = join(dir, name);
  if (!existsSync(source)) throw new Error(`Bun artifact ${dir} is missing ${name}`);
  const localVersion = readLocalBunVersion(fromDir);
  if (localVersion !== version) {
    throw new Error(`Bun artifact version ${localVersion} does not match requested ${version}`);
  }
  const expected = expectedChecksum(dir, name);
  if (expected) {
    const actual = sha256(readFileSync(source));
    if (actual !== expected) throw new Error(`Bun artifact checksum mismatch for ${name}`);
  }
  copyFileSync(source, targetBin);
}

function linkBunToPath(layout: InstallLayout, targetBin: string): string {
  const link = join(layout.binDir, bunBinName(layout.platform));
  mkdirSync(layout.binDir, { recursive: true, mode: 0o755 });
  try {
    unlinkSync(link);
  } catch { /* missing is fine */ }
  symlinkSync(targetBin, link);
  return link;
}

/** Install (or plan) the optional Bun toolchain. */
export async function installBunRuntime(
  layout: InstallLayout,
  options: InstallBunOptions = {},
): Promise<InstallBunResult> {
  const version = options.version
    ?? (options.fromDir ? readLocalBunVersion(options.fromDir) : await resolveLatestBunVersion(options.fetchImpl));
  const dir = bunRuntimeDir(layout, version);
  const bin = bunRuntimeBin(layout, version);
  const source: "local" | "network" = options.fromDir ? "local" : "network";
  const dryRun = options.dryRun !== false;
  if (dryRun) {
    return { version, dir, bin, source, dryRun: true, written: [] };
  }

  mkdirSync(dir, { recursive: true, mode: 0o755 });
  if (options.fromDir) copyLocalBun(options.fromDir, bin, version, layout.platform);
  else await downloadBun(version, bin, options);
  chmodSync(bin, 0o755);

  const written = [bin];
  const pathLink = options.addToPath === true ? linkBunToPath(layout, bin) : undefined;
  if (pathLink) written.push(pathLink);
  return { version, dir, bin, source, dryRun: false, written, ...(pathLink ? { pathLink } : {}) };
}

/** Remove one installed Bun version, or all versions when `version` is omitted. */
export function removeBunRuntime(layout: InstallLayout, version?: string): string[] {
  const root = bunRuntimeRoot(layout);
  const versions = version ? [version] : listInstalledBunVersions(layout);
  const removed: string[] = [];
  for (const v of versions) {
    const dir = bunRuntimeDir(layout, v);
    if (!existsSync(dir)) continue;
    rmSync(dir, { recursive: true, force: true });
    removed.push(dir);
    const link = join(layout.binDir, bunBinName(layout.platform));
    try {
      if (existsSync(link)) unlinkSync(link);
    } catch { /* best-effort PATH link cleanup */ }
  }
  try {
    if (existsSync(root) && readdirSync(root).length === 0) rmSync(root, { recursive: true, force: true });
  } catch { /* best-effort */ }
  return removed;
}
