#!/usr/bin/env node
// scripts/build-js.mjs — build the Node-loadable ESM CLI bundle shipped on npm.
// ---------------------------------------------------------------------------
// WHY THIS EXISTS: the published package must run on a Node-only machine via
// `npx rolecall` / `npm i -g rolecall`. That requires (a) regenerating the
// embedded docs corpus, which the bundle inlines, (b) bundling the build-only
// Node entry (scripts/cli-node-entry.mjs) with a node shebang, and (c) passing
// the Node-safety guard (scripts/verify-node-bundle.mjs). We drive the three
// steps from a small Node script — rather than a chained package.json one-liner
// — so every command is spawned with an args ARRAY, which dodges shell quoting
// entirely and behaves identically on linux/mac/windows.
//
// Output: lib/cli.js (+ lib/cli.js.map). `lib/` is the published bin target
// (see package.json "bin" and "files"); `dist/` stays reserved for the native
// binaries produced by the untouched scripts/build-bin.mjs.

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

// Absolute output path: bun resolves a relative --outfile against the entry
// file, not the cwd, so we hand it the fully-resolved lib/cli.js.
const OUT_FILE = resolve(ROOT, "lib", "cli.js");

function bunExe() {
  return process.env.BIN_BUN || process.env.BIN_BIN_PATH || "bun";
}

function run(exe, args, label) {
  console.log(`\n>>> ${label}`);
  console.log(`    ${exe} ${args.join(" ")}`);
  const res = spawnSync(exe, args, { cwd: ROOT, stdio: "inherit" });
  if (res.error) {
    console.error(`build:js FAILED — could not spawn ${exe}: ${res.error.message}`);
    process.exit(1);
  }
  if (res.status !== 0) {
    console.error(`build:js FAILED — ${label} exited ${res.status}`);
    process.exit(res.status === null ? 1 : res.status);
  }
}

// 1. Embedded docs MUST be regenerated before bundling — src/docs/embedded-content.ts
//    is inlined into the bundle, so a stale corpus would ship stale prose.
run(bunExe(), ["scripts/embed-docs.ts"], "regenerate embedded docs");

// 2. Bundle the Node entry to lib/cli.js. --packages=external keeps third-party
//    packages as runtime imports (they must be real dependencies), and the
//    banner supplies the node shebang the verifier below asserts on.
//
//    Sourcemap note: the intended `--sourcemap=external` is unusable here —
//    Bun 1.3.x rejects it with `--outfile` ("cannot use an external source map
//    without --outdir") and its `--sourcemap=linked` sibling mis-resolves the
//    outfile, writing cli.js next to the entry instead of into lib/. We use
//    `--sourcemap=inline`, the only mode that keeps the map embedded while
//    honoring the exact `--outfile=.../lib/cli.js` target.
run(
  bunExe(),
  [
    "build",
    "scripts/cli-node-entry.mjs",
    "--target=node",
    "--packages=external",
    // NB: use the `--flag=value` form. Bun 1.3.x mis-resolves a space-separated
    // `--outfile <path>` (it writes next to the entry file as basename), so the
    // equals form is required for a correct, quotes-free argv array.
    `--outfile=${OUT_FILE}`,
    "--sourcemap=inline",
    "--banner=#!/usr/bin/env node",
  ],
  "bundle Node CLI -> lib/cli.js",
);

// 3. Fail the build if the bundle is not Node-safe.
run(process.execPath, ["scripts/verify-node-bundle.mjs"], "verify bundle is Node-safe");

console.log("\nbuild:js OK — lib/cli.js is ready to publish.");
