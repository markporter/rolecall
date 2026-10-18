#!/usr/bin/env bun
// Thin NATIVE DISPATCH SHIM for cross-platform compiled binaries.
// -----------------------------------------------
// This file is NOT product logic — it lives outside `src/` and exists purely as
// the compile entrypoint driven by `scripts/build-bin.mjs`. Its only job is to
// route two concerns that behave differently once bundled into a standalone
// executable, then delegate everything else to the unchanged RoleCall CLI `main()`.
//
// WHY THIS EXISTS
//   A bun `--compile` binary embeds its code in bun's virtual filesystem, so
//   `import.meta.url` resolves to something like `file:///$bunfs/root/<name>`.
//   Reading a sibling "../../package.json" relative to that path (which the
//   internal getVersion() in src/cli/index.ts does) therefore fails with ENOENT
//   and throws before any usable output is produced. To keep the shipped binary
//   self-contained we resolve --version HERE instead of inside main().
//
// VERSION INJECTION
//   `scripts/build-bin.mjs` bakes the real project version into the bundle with
//   bun's --banner flag as `globalThis.__ROLECALL_VERSION__="<ver>"`, which executes
//   first. We read it there; when running unbundled (dev / direct `bun run`) we
//   fall back to reading the sibling package.json normally.

import { main } from "../src/cli/index.ts";

const VERSION_KEY = "__ROLECALL_VERSION__";

async function resolveVersion() {
  const baked = globalThis[VERSION_KEY];
  if (typeof baked === "string" && baked.length > 0) return baked;

  // Unbundled fallback: read ./package.json next to this shim.
  try {
    const pkgUrl = new URL("../package.json", import.meta.url);
    const raw = await Bun.file(pkgUrl).text();
    const ver = JSON.parse(raw).version;
    return typeof ver === "string" ? ver : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function wantsVersion(argv) {
  const rest = argv.slice(2);
  return rest.includes("--version") || rest.includes("-v");
}

export async function nativeMain(argv) {
  if (wantsVersion(argv)) {
    process.stdout.write(`rolecall ${await resolveVersion()}\n`);
    return 0;
  }
  const code = await main(argv);
  return typeof code === "number" ? code : 0;
}

// This module is only ever used as a compile entrypoint (never `import`ed),
// so dispatch unconditionally regardless of the runtime invoking it.
process.exit(await nativeMain(process.argv));
