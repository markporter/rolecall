// ADR 0029 pre-beta update discovery: GitHub Releases + signed release.json.
//
// Ed25519 detached signatures use node:crypto on both runtimes. The default
// source is the GitHub repository in package.json; ROLECALL_UPDATE_URL selects a
// mirror that serves release.json + release.json.sig. Signatures and checksums
// are verified before the manifest/artifact is used.

import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import pkg from "../../package.json";
import { EMBEDDED_RELEASE_PUBLIC_KEYS } from "./release-key";

export interface ReleaseArtifact {
  url: string;
  sha256: string;
  size: number;
}

export interface ReleaseManifest {
  schemaVersion: 1;
  version: string;
  tag: string;
  releasedAt?: string;
  keyId: string;
  artifacts: Record<string, ReleaseArtifact>;
}

export interface FetchLike {
  (input: string, init?: RequestInit): Promise<Response>;
}

export interface CheckForUpdateOptions {
  currentVersion?: string;
  /** Base URL for a mirror serving release.json + release.json.sig. */
  updateUrl?: string;
  /** GitHub owner/repo override. */
  repo?: string;
  token?: string;
  fetchImpl?: FetchLike;
  /** PEM encoded Ed25519 public keys (defaults to ROLECALL_RELEASE_PUBLIC_KEY). */
  publicKeys?: string[];
  platform?: string;
  arch?: string;
}

export interface UpdateCandidate {
  manifest: ReleaseManifest;
  artifact: ReleaseArtifact;
  artifactKey: string;
  currentVersion?: string;
  updateAvailable: boolean;
  source: string;
}

function releaseRepo(): string {
  const value = (pkg as { repository?: { url?: string } | string }).repository;
  const url = typeof value === "string" ? value : value?.url ?? "";
  const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?/);
  return match ? `${match[1]}/${match[2]}` : "markporter/rolecall";
}

/** Platform artifact key matching scripts/build-bin.mjs target names. */
export function artifactKeyFor(platform: string, arch: string): string {
  if (platform === "linux") return arch === "arm64" ? "linux-arm64-musl" : "linux-x64-musl";
  if (platform === "darwin") return arch === "arm64" ? "darwin-arm64-musl" : "darwin-x64-musl";
  if (platform === "win32") return "windows-x64";
  return `${platform}-${arch}`;
}

export function parseSemver(value: string): { core: number[]; pre: string[] } {
  const clean = value.trim().replace(/^v/i, "").split("+")[0]!;
  const [core, pre] = clean.split("-", 2);
  return {
    core: (core ?? "").split(".").map((n) => Number.parseInt(n, 10) || 0),
    pre: pre ? pre.split(".") : [],
  };
}

/** Semver-ish comparison (stable > prerelease for the same core). */
export function compareSemver(a: string, b: string): number {
  const av = parseSemver(a);
  const bv = parseSemver(b);
  for (let i = 0; i < Math.max(av.core.length, bv.core.length); i++) {
    const d = (av.core[i] ?? 0) - (bv.core[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  if (av.pre.length === 0 && bv.pre.length > 0) return 1;
  if (bv.pre.length === 0 && av.pre.length > 0) return -1;
  for (let i = 0; i < Math.max(av.pre.length, bv.pre.length); i++) {
    const x = av.pre[i];
    const y = bv.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (xn !== yn) {
      return xn ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

export function loadReleasePublicKeys(extra?: string[]): string[] {
  const keys = [...EMBEDDED_RELEASE_PUBLIC_KEYS, ...(extra ?? [])];
  const direct = process.env["ROLECALL_RELEASE_PUBLIC_KEY"];
  if (direct) keys.push(direct);
  const file = process.env["ROLECALL_RELEASE_PUBLIC_KEY_FILE"];
  if (file && existsSync(file)) keys.push(readFileSync(file, "utf8"));
  return keys;
}

/** Verify an Ed25519 detached signature over the exact manifest bytes. */
export function verifyReleaseManifest(
  manifestBytes: Buffer,
  signature: Buffer,
  publicKeys: string[],
): boolean {
  if (publicKeys.length === 0) {
    throw new Error(
      "no release public key configured: set ROLECALL_RELEASE_PUBLIC_KEY or ROLECALL_RELEASE_PUBLIC_KEY_FILE",
    );
  }
  for (const pem of publicKeys) {
    try {
      const key = createPublicKey(pem);
      if (verifySignature(null, manifestBytes, key, signature)) return true;
    } catch { /* try next key */ }
  }
  return false;
}

export function parseReleaseManifest(bytes: Buffer | string): ReleaseManifest {
  const parsed = JSON.parse(typeof bytes === "string" ? bytes : bytes.toString("utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("release.json must be an object");
  }
  const m = parsed as Record<string, unknown>;
  if (m["schemaVersion"] !== 1) throw new Error("release.json schemaVersion must be 1");
  if (typeof m["version"] !== "string" || !m["version"]) throw new Error("release.json version is required");
  if (typeof m["tag"] !== "string" || !m["tag"]) throw new Error("release.json tag is required");
  if (typeof m["keyId"] !== "string" || !m["keyId"]) throw new Error("release.json keyId is required");
  const artifacts = m["artifacts"];
  if (typeof artifacts !== "object" || artifacts === null || Array.isArray(artifacts)) {
    throw new Error("release.json artifacts must be an object");
  }
  const out: ReleaseManifest["artifacts"] = {};
  for (const [key, value] of Object.entries(artifacts as Record<string, unknown>)) {
    const a = value as Record<string, unknown>;
    if (typeof a["url"] !== "string" || typeof a["sha256"] !== "string" || typeof a["size"] !== "number") {
      throw new Error(`release.json artifact '${key}' needs url, sha256, size`);
    }
    out[key] = { url: a["url"], sha256: a["sha256"], size: a["size"] };
  }
  return {
    schemaVersion: 1,
    version: m["version"],
    tag: m["tag"],
    keyId: m["keyId"],
    ...(typeof m["releasedAt"] === "string" ? { releasedAt: m["releasedAt"] } : {}),
    artifacts: out,
  };
}

function authHeaders(token?: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "rolecall-update",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

interface GitHubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: Array<{ name: string; browser_download_url: string }>;
}

/** Pre-beta single stream: highest non-draft semver across GitHub Releases. */
export async function discoverPreBetaRelease(
  repo: string,
  fetchImpl: FetchLike,
  token?: string,
): Promise<{ tag: string; assets: Array<{ name: string; url: string }> }> {
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases?per_page=100`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`GitHub release discovery failed: HTTP ${res.status}`);
  const releases = (await res.json()) as GitHubRelease[];
  const candidates = releases
    .filter((r) => !r.draft)
    .map((r) => ({ r, version: parseSemver(r.tag_name) }))
    .sort((a, b) => compareSemver(b.r.tag_name, a.r.tag_name));
  const pick = candidates[0];
  if (!pick) throw new Error("no non-draft GitHub releases found");
  return {
    tag: pick.r.tag_name,
    assets: pick.r.assets.map((a) => ({ name: a.name, url: a.browser_download_url })),
  };
}

async function fetchManifestAndSignature(
  manifestUrl: string,
  signatureUrl: string,
  fetchImpl: FetchLike,
  token?: string,
): Promise<{ manifest: ReleaseManifest; bytes: Buffer }> {
  const [mres, sres] = await Promise.all([
    fetchImpl(manifestUrl, { headers: authHeaders(token) }),
    fetchImpl(signatureUrl, { headers: authHeaders(token) }),
  ]);
  if (!mres.ok) throw new Error(`release.json download failed: HTTP ${mres.status}`);
  if (!sres.ok) throw new Error(`release.json.sig download failed: HTTP ${sres.status}`);
  const bytes = Buffer.from(await mres.arrayBuffer());
  const signature = Buffer.from(await sres.arrayBuffer());
  const keys = loadReleasePublicKeys();
  if (!verifyReleaseManifest(bytes, signature, keys)) {
    throw new Error("release.json signature verification failed");
  }
  return { manifest: parseReleaseManifest(bytes), bytes };
}

/** Discover and verify the latest pre-beta release for this platform. */
export async function checkForUpdate(options: CheckForUpdateOptions = {}): Promise<UpdateCandidate> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const token = options.token ?? process.env["GITHUB_TOKEN"] ?? process.env["GH_TOKEN"];
  const updateUrl = options.updateUrl ?? process.env["ROLECALL_UPDATE_URL"];
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  let manifestUrl: string;
  let signatureUrl: string;
  let source: string;
  if (updateUrl) {
    const base = updateUrl.replace(/\/$/, "");
    manifestUrl = `${base}/release.json`;
    signatureUrl = `${base}/release.json.sig`;
    source = base;
  } else {
    const release = await discoverPreBetaRelease(options.repo ?? releaseRepo(), fetchImpl, token);
    const manifestAsset = release.assets.find((a) => a.name === "release.json");
    const signatureAsset = release.assets.find((a) => a.name === "release.json.sig");
    if (!manifestAsset || !signatureAsset) {
      throw new Error(`release ${release.tag} is missing release.json/release.json.sig`);
    }
    manifestUrl = manifestAsset.url;
    signatureUrl = signatureAsset.url;
    source = release.tag;
  }
  const { manifest } = await fetchManifestAndSignature(manifestUrl, signatureUrl, fetchImpl, token);
  const artifactKey = artifactKeyFor(platform, arch);
  const artifact = manifest.artifacts[artifactKey];
  if (!artifact) throw new Error(`release ${manifest.version} has no artifact for ${artifactKey}`);
  const currentVersion = options.currentVersion;
  return {
    manifest,
    artifact,
    artifactKey,
    ...(currentVersion ? { currentVersion } : {}),
    updateAvailable: currentVersion ? compareSemver(manifest.version, currentVersion) > 0 : true,
    source,
  };
}

/** Download an artifact and verify its size and SHA-256. */
export async function downloadReleaseArtifact(
  candidate: UpdateCandidate,
  dest: string,
  fetchImpl: FetchLike = fetch,
  token?: string,
): Promise<void> {
  const res = await fetchImpl(candidate.artifact.url, {
    headers: token ? { Authorization: `Bearer ${token}`, "User-Agent": "rolecall-update" } : { "User-Agent": "rolecall-update" },
  });
  if (!res.ok) throw new Error(`artifact download failed: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length !== candidate.artifact.size) {
    throw new Error(`artifact size mismatch: expected ${candidate.artifact.size}, got ${bytes.length}`);
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== candidate.artifact.sha256.toLowerCase()) {
    throw new Error("artifact SHA-256 mismatch");
  }
  writeFileSync(dest, bytes, { mode: 0o755 });
}
