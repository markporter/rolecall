import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseReleaseManifest, verifyReleaseManifest } from "../src/install/release";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

test("build-release-manifest writes a verifiable manifest and checksums", () => {
  const dir = mkdtempSync(join(tmpdir(), "rolecall-manifest-"));
  dirs.push(dir);
  const binDir = join(dir, "bin");
  const outDir = join(dir, "out");
  const { mkdirSync } = require("node:fs") as typeof import("node:fs");
  mkdirSync(binDir, { recursive: true });
  const artifact = Buffer.from("#!/bin/sh\necho binary\n");
  writeFileSync(join(binDir, "rolecall-linux-x64-musl"), artifact, { mode: 0o755 });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const res = spawnSync(process.execPath, [
    resolve("scripts/build-release-manifest.mjs"),
    "--dir", binDir,
    "--version", "0.0.4",
    "--tag", "v0.0.4",
    "--repo", "owner/repo",
    "--out", outDir,
  ], {
    env: { ...process.env, ROLECALL_RELEASE_PRIVATE_KEY: privatePem, ROLECALL_RELEASE_KEY_ID: "test" },
    encoding: "utf8",
  });
  expect(res.status).toBe(0);
  const manifestBytes = readFileSync(join(outDir, "release.json"));
  const signature = readFileSync(join(outDir, "release.json.sig"));
  expect(verifyReleaseManifest(manifestBytes, signature, [publicPem])).toBe(true);
  const manifest = parseReleaseManifest(manifestBytes);
  expect(manifest.version).toBe("0.0.4");
  expect(manifest.artifacts["linux-x64-musl"]?.sha256).toBe(createHash("sha256").update(artifact).digest("hex"));
  expect(readFileSync(join(outDir, "SHA256SUMS"), "utf8")).toContain("rolecall-linux-x64-musl");
});
