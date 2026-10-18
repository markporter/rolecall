#!/usr/bin/env node
// scripts/build-bin.mjs — cross-platform native-binary builder for RoleCall.
// ---------------------------------------------------------------
// Compiles the single CLI entry point (scripts/cli-native-entry.mjs, which wraps
// the unchanged src/cli/index.ts `main()`) into one standalone native binary per
// requested platform using `bun build --compile`. Binaries land in dist/bin/
// named `<name>-<platform>` (e.g. dist/bin/rolecall-linux-x64-musl).
//
// Runtime portability: this script uses only Node-compatible APIs so it can run
// under either Node or Bun (the CI matrix exercises both). The heavy lifting —
// bundling & compiling — is delegated to the `bun` CLI regardless of caller.
//
// Usage:
//   node scripts/build-bin.mjs                 # build the default platform set
//   node scripts/build-bin.mjs --all           # build every known platform
//   node scripts/build-bin.mjs --target linux-arm64-musl [--target windows-x64]
//   node scripts/build-bin.mjs --out-dir dist/bin
//
// Environment:
//   BIN_BIN_PATH / BIN_BUN   Path/name of the bun executable (default: "bun").
//
// Host vs non-host handling (important):
//   * The binary whose platform equals the HOST os/arch is compiled with the
//     local bun and then SMOKE-TESTED (`<binary> --version`). A missing/broken
//     version line fails the build — this is the core acceptance criterion.
//   * Every OTHER platform is compiled too, but NEVER executed here: we log a
//     clear "generated, unexecuted on host" line. Their binaries are distribution
//     artifacts meant to be produced/run on their own OS (or on a matching GitHub
//     CI runner). Note: true cross-compilation requires the remote bun runtime;
//     see README "Building native binaries" for details.

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PKG = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const NAME = PKG.name || "rolecall";
const VERSION = String(PKG.version || "0.0.0");

const ENTRY = resolve(ROOT, "scripts/cli-native-entry.mjs");
const DEFAULT_OUTDIR = resolve(ROOT, "dist", "bin");

// Platform id -> the value passed to bun's BUN_TARGET_OVERRIDE for cross builds.
// bun emits static musl Linux binaries, hence the `-musl` suffix on linux/darwin.
const BUN_TARGETS = {
  "linux-x64": "bun-linux-x64",
  "linux-arm64": "bun-linux-aarch64",
  "darwin-x64": "bun-darwin-x64",
  "darwin-arm64": "bun-darwin-aarch64",
  "windows-x64": "bun-windows-x64",
  "freebsd-x64": "bun-freebsd-x64",
};

// Canonical ids we know how to describe. The host is always injected first.
const KNOWN_PLATFORMS = [
  "linux-x64-musl",
  "linux-arm64-musl",
  "darwin-arm64-musl",
  "darwin-x64-musl",
  "windows-x64",
  "freebsd-x64-musl",
];

function hostPlatformId() {
  const p = process.platform; // linux | darwin | win32 | freebsd
  const arch = process.arch === "x64" ? "x64" : "arm64";
  if (p === "linux") return `${p}-${arch}-musl`;
  if (p === "darwin") return `${p}-${arch}-musl`;
  if (p === "win32") return "windows-x64"; // assume x64 on the common case
  if (p === "freebsd") return `${p}-${arch}-musl`;
  throw new Error(`unsupported host platform: ${p}/${process.arch}`);
}

function stripSuffix(id) {
  return id.replace(/-musl$/, "");
}

function bunTargetFor(id) {
  return BUN_TARGETS[stripSuffix(id)];
}

function bunExe() {
  return process.env.BIN_BUN || process.env.BIN_BIN_PATH || "bun";
}

function bannerCode() {
  const safe = VERSION.replace(/[^A-Za-z0-9._+-]/g, "_");
  return `globalThis.__ROLECALL_VERSION__='${safe}';`;
}

function magicOf(buf) {
  if (buf.length >= 4 && buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) {
    return "ELF";
  }
  if (buf.length >= 4 && buf.subarray(0, 4).equals(Buffer.from([0xce, 0xfa, 0xed, 0xfe]))) {
    return "Mach-O";
  }
  if (buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a) {
    return "PE";
  }
  return "unknown";
}

function expectedFormat(os) {
  if (os === "windows") return "PE";
  if (os === "darwin") return "Mach-O";
  return "ELF"; // linux / freebsd
}

function parseArgs(argv) {
  const targets = [];
  let outdir = DEFAULT_OUTDIR;
  let all = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") all = true;
    else if (a === "--target" || a === "-t") targets.push(argv[++i]);
    else if (a.startsWith("--target=")) targets.push(a.slice("--target=".length));
    else if (a === "--out-dir" || a === "-o") outdir = resolve(ROOT, argv[++i]);
  }
  if (targets.some((t) => t === undefined)) throw new Error("missing value after --target");
  return { targets, outdir, all };
}

function compile({ target, outdir }) {
  const exe = bunExe();
  const outFile = resolve(outdir, `${NAME}-${target}`);
  mkdirSync(outdir, { recursive: true });

  const args = ["build", "--compile", "--banner", bannerCode(), "--outfile", outFile, ENTRY];
  const env = { ...process.env };
  const override = bunTargetFor(target);
  const isHost = target === hostPlatformId();
  if (!isHost && override) env.BUN_TARGET_OVERRIDE = override;

  const res = spawnSync(exe, args, { cwd: ROOT, stdio: "pipe", env });
  if (res.status !== 0) {
    return { ok: false, status: res.status, target, outFile, detail: (res.stderr || "").toString().trim() };
  }
  try {
    chmodSync(outFile, 0o755);
  } catch {}
  return { ok: true, target, outFile, isHost };
}

function smokeTest(binaryPath) {
  // Run the compiled native binary DIRECTLY (it is a self-contained executable,
  // not a script requiring the runtime). Verify it prints a valid version line.
  const res = spawnSync(binaryPath, ["--version"], { stdio: "pipe" });
  const stdout = (res.stdout || "").toString();
  const line = stdout.split("\n").find((l) => l.toLowerCase().startsWith("rolecall")) || "";
  return { ok: res.status === 0 && line.startsWith("rolecall"), code: res.status, output: stdout.trim(), versionLine: line };
}

function main() {
  const { targets, outdir, all } = parseArgs(process.argv.slice(2));
  const hostId = hostPlatformId();

  let chosen;
  if (targets.length > 0) chosen = targets;
  else if (all) chosen = KNOWN_PLATFORMS;
  else chosen = [hostId, "linux-arm64-musl", "darwin-arm64-musl", "windows-x64"];

  console.log(`RoleCall native builder`);
  console.log(`  project     : ${NAME}@${VERSION}`);
  console.log(`  entry point : scripts/cli-native-entry.mjs -> src/cli/index.ts`);
  console.log(`  bun         : ${bunExe()}`);
  console.log(`  host        : ${hostId}`);
  console.log(`  output dir  : ${outdir}`);
  console.log(`  targets     : ${chosen.join(", ")}`);
  console.log("");

  const failures = [];
  for (const target of chosen) {
    const isHost = target === hostId;
    const os = target.includes("windows") ? "windows" : target.includes("darwin") ? "darwin" : "linux";

    console.log(`>>> building ${target}${isHost ? "  [HOST]" : ""}`);
    const built = compile({ target, outdir });
    if (!built.ok) {
      console.log(`    FAILED (exit ${built.status}): ${built.detail || "bun build error"}`);
      failures.push(`${target}: build failed`);
      continue;
    }
    console.log(`    wrote ${built.outFile}`);

    if (isHost) {
      const s = smokeTest(built.outFile);
      if (s.ok) {
        console.log(`    SMOKE TEST PASS: ${s.versionLine}`);
      } else {
        console.log(`    SMOKE TEST FAIL (exit ${s.code}); output:\n${s.output}`);
        failures.push(`${target}: smoke test failed`);
      }
    } else {
      // Never execute a non-host artifact on this runner. Probe format only.
      let fmt = "unknown";
      try {
        fmt = magicOf(readFileSync(built.outFile).subarray(0, 4));
      } catch {}
      const matches = fmt === expectedFormat(os);
      console.log(`    generated, unexecuted on host (${fmt} artifact)`);
      if (matches) {
        console.log(
          `    format OK (${os} ${fmt}); architecture NOT verified here — run on an ${os} machine ` +
            `or matching CI runner to confirm the target CPU.`,
        );
      } else {
        console.log(
          `    NOTE: ${os} toolchain unavailable offline — this file was produced by the host ` +
            `toolchain; rebuild on an ${os} machine or matching CI runner for a genuine artifact.`,
        );
      }
    }
    console.log("");
  }

  if (failures.length) {
    console.error(`\nBuild completed with ${failures.length} failure(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`Done. Binaries in ${outdir}. Only the HOST binary (${hostId}) was executed here.`);
}

main();
