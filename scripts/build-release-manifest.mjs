#!/usr/bin/env node
// ADR 0029: build release.json + Ed25519 detached signature + SHA256SUMS.
//
// Usage:
//   node scripts/build-release-manifest.mjs --dir dist/bin --version 0.0.4 \
//     --tag v0.0.4 --out dist/release
//
// Env:
//   ROLECALL_RELEASE_PRIVATE_KEY  Ed25519 PKCS#8 PEM (required)
//   ROLECALL_RELEASE_KEY_ID       key id (default rolecall-release)

import { createHash, createPrivateKey, sign } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function arg(name, fallback) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

const dir = resolve(arg("--dir", "dist/bin"));
const outDir = resolve(arg("--out", "dist/release"));
const version = arg("--version");
const tag = arg("--tag");
const keyId = process.env.ROLECALL_RELEASE_KEY_ID || "rolecall-release";
const privateKeyPem = process.env.ROLECALL_RELEASE_PRIVATE_KEY;

if (!version || !tag) throw new Error("--version and --tag are required");
if (!privateKeyPem) throw new Error("ROLECALL_RELEASE_PRIVATE_KEY is required");

const artifacts = {};
const checksums = [];
for (const entry of readdirSync(dir)) {
  if (!entry.startsWith("rolecall-")) continue;
  const path = join(dir, entry);
  if (!statSync(path).isFile()) continue;
  const bytes = readFileSync(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  artifacts[entry.slice("rolecall-".length)] = {
    url: `https://github.com/${arg("--repo", "markporter/rolecall")}/releases/download/${tag}/${entry}`,
    sha256,
    size: bytes.length,
  };
  checksums.push(`${sha256}  ${entry}`);
}
if (Object.keys(artifacts).length === 0) throw new Error(`no rolecall-* artifacts found in ${dir}`);

const manifest = {
  schemaVersion: 1,
  version,
  tag,
  releasedAt: new Date().toISOString(),
  keyId,
  artifacts,
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
const signature = sign(null, manifestBytes, createPrivateKey(privateKeyPem));

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "release.json"), manifestBytes);
writeFileSync(join(outDir, "release.json.sig"), signature);
writeFileSync(join(outDir, "SHA256SUMS"), `${checksums.join("\n")}\n`);
console.log(`release manifest: ${join(outDir, "release.json")} (${Object.keys(artifacts).length} artifacts)`);
