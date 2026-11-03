import { afterEach, expect, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { runUpdateCommand } from "../src/cli/commands/update";
import type { GlobalFlags } from "../src/cli/types";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  artifactKeyFor,
  compareSemver,
  discoverPreBetaRelease,
  downloadReleaseArtifact,
  parseReleaseManifest,
  verifyReleaseManifest,
  type FetchLike,
} from "../src/install/release";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const pub = publicKey.export({ type: "spki", format: "pem" }).toString();
const previous = process.env["ROLECALL_RELEASE_PUBLIC_KEY"];
afterEach(() => {
  if (previous === undefined) delete process.env["ROLECALL_RELEASE_PUBLIC_KEY"];
  else process.env["ROLECALL_RELEASE_PUBLIC_KEY"] = previous;
});

function manifest(version = "0.0.4") {
  const bytes = Buffer.from("artifact-bytes");
  return {
    json: {
      schemaVersion: 1,
      version,
      tag: `v${version}`,
      keyId: "test",
      artifacts: {
        "linux-x64-musl": {
          url: "https://example.test/rolecall",
          sha256: createHash("sha256").update(bytes).digest("hex"),
          size: bytes.length,
        },
      },
    },
    bytes,
  };
}

function signManifest(json: unknown): { bytes: Buffer; signature: Buffer } {
  const bytes = Buffer.from(JSON.stringify(json));
  return { bytes, signature: sign(null, bytes, privateKey) };
}

test("artifact keys and semver comparison", () => {
  expect(artifactKeyFor("linux", "x64")).toBe("linux-x64-musl");
  expect(artifactKeyFor("darwin", "arm64")).toBe("darwin-arm64-musl");
  expect(artifactKeyFor("win32", "x64")).toBe("windows-x64");
  expect(compareSemver("0.0.10", "0.0.9")).toBe(1);
  expect(compareSemver("0.1.0", "0.1.0-beta.1")).toBe(1);
  expect(compareSemver("0.1.0-beta.2", "0.1.0-beta.1")).toBe(1);
});

test("manifest signature verification accepts only signed bytes", () => {
  process.env["ROLECALL_RELEASE_PUBLIC_KEY"] = pub;
  const { json } = manifest();
  const { bytes, signature } = signManifest(json);
  expect(verifyReleaseManifest(bytes, signature, [pub])).toBe(true);
  const tampered = Buffer.from(bytes);
  tampered[0] = (tampered[0]! + 1) & 0xff;
  expect(verifyReleaseManifest(tampered, signature, [pub])).toBe(false);
  expect(parseReleaseManifest(bytes).version).toBe("0.0.4");
});

test("mirror check verifies manifest and selects the platform artifact", async () => {
  process.env["ROLECALL_RELEASE_PUBLIC_KEY"] = pub;
  const { json } = manifest();
  const { bytes, signature } = signManifest(json);
  const fetchImpl: FetchLike = async (url) => {
    if (url.endsWith("release.json")) return new Response(bytes);
    if (url.endsWith("release.json.sig")) return new Response(signature);
    return new Response("not found", { status: 404 });
  };
  const { checkForUpdate } = await import("../src/install/release");
  const candidate = await checkForUpdate({
    currentVersion: "0.0.3",
    updateUrl: "https://mirror.test/update",
    fetchImpl,
    platform: "linux",
    arch: "x64",
    publicKeys: [pub],
  });
  expect(candidate.manifest.version).toBe("0.0.4");
  expect(candidate.updateAvailable).toBe(true);
  expect(candidate.artifactKey).toBe("linux-x64-musl");
});

test("download verifies size and checksum", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rolecall-release-"));
  try {
    const { json, bytes } = manifest();
    const { checkForUpdate } = await import("../src/install/release");
    process.env["ROLECALL_RELEASE_PUBLIC_KEY"] = pub;
    const signed = signManifest(json);
    const candidate = await checkForUpdate({
      updateUrl: "https://mirror.test/update",
      platform: "linux",
      arch: "x64",
      publicKeys: [pub],
      fetchImpl: async (url) => {
        if (url.endsWith("release.json")) return new Response(signed.bytes);
        if (url.endsWith("release.json.sig")) return new Response(signed.signature);
        return new Response(bytes);
      },
    });
    const dest = join(dir, "rolecall");
    await downloadReleaseArtifact(candidate, dest, async () => new Response(bytes));
    expect(readFileSync(dest)).toEqual(bytes);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pre-beta discovery selects the highest non-draft release", async () => {
  const fetchImpl: FetchLike = async () =>
    new Response(JSON.stringify([
      { tag_name: "v0.0.3", draft: false, prerelease: true, assets: [{ name: "release.json", browser_download_url: "u3" }] },
      { tag_name: "v0.0.5", draft: true, prerelease: true, assets: [{ name: "release.json", browser_download_url: "u5" }] },
      { tag_name: "v0.0.4", draft: false, prerelease: true, assets: [{ name: "release.json", browser_download_url: "u4" }] },
    ]));
  const release = await discoverPreBetaRelease("owner/repo", fetchImpl);
  expect(release.tag).toBe("v0.0.4");
});

test("update --check discovers a signed manifest from a mirror", async () => {
  process.env["ROLECALL_RELEASE_PUBLIC_KEY"] = pub;
  const { json } = manifest("0.0.5");
  const signed = signManifest(json);
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/release.json") return new Response(signed.bytes);
      if (url.pathname === "/release.json.sig") return new Response(signed.signature);
      return new Response("not found", { status: 404 });
    },
  });
  const dir = mkdtempSync(join(tmpdir(), "rolecall-update-check-"));
  try {
    const flags: GlobalFlags = {
      force: false,
      check: true,
      diff: false,
      output: "json",
      trace: false,
      profile: false,
      isolation: "none",
      user: true,
      updateUrl: `http://127.0.0.1:${server.port}`,
      configDir: join(dir, "config"),
      stateDir: join(dir, "state"),
      prefix: join(dir, "lib"),
    };
    const res = await runUpdateCommand(flags, []);
    if (res.command !== "update") throw new Error("unexpected");
    expect(res.check?.candidateVersion).toBe("0.0.5");
    expect(res.check?.updateAvailable).toBe(true);
  } finally {
    server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
});
