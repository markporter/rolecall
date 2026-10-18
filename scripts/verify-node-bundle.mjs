#!/usr/bin/env node
// scripts/verify-node-bundle.mjs — packaging guard for the Node bundle.
// -------------------------------------------------------------------
// WHY THIS EXISTS: lib/cli.js must load on a Node-only machine. Two classes of
// regression silently break that, and both are cheap to catch here rather than
// after `npm publish`:
//
//   1. A Bun-only module import (`bun:sqlite`, `drizzle-orm/bun-sqlite`) either
//      statically or via dynamic `import(...)` — Node cannot resolve these and
//      the process dies at load. The *safe* form keeps the bare string
//      `bun:sqlite` inside a lazy `createRequire(...)("bun:sqlite")` call that
//      only runs under Bun, so we deliberately do NOT forbid the bare string —
//      only real import syntax.
//   2. Leftover Bun-only entrypoint machinery (`import.meta.main`, `Bun.argv`)
//      that would auto-run or crash under Node.
//
// It also asserts the bundle starts with a `#!/usr/bin/env node` shebang so
// `npx rolecall` / the installed bin can execute it directly.
//
// Run by scripts/build-js.mjs immediately after bundling. Exits 1 with a clear
// per-violation message on any failure.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const BUNDLE = resolve(ROOT, "lib", "cli.js");

// Each entry pairs a human-readable reason with the regex that detects it.
const FORBIDDEN = [
  { why: "static import of bun:sqlite (Node cannot resolve it)", re: /from\s*["']bun:sqlite["']/ },
  {
    why: "static import of drizzle-orm/bun-sqlite (Node cannot resolve it)",
    re: /from\s*["']drizzle-orm\/bun-sqlite["']/,
  },
  {
    why: "dynamic import() of bun:sqlite (Node cannot resolve it)",
    re: /import\s*\(\s*["']bun:sqlite["']\s*\)/,
  },
  {
    why: "dynamic import() of drizzle-orm/bun-sqlite (Node cannot resolve it)",
    re: /import\s*\(\s*["']drizzle-orm\/bun-sqlite["']\s*\)/,
  },
  { why: "self-dispatch remnant: import.meta.main (Bun-only, crashes Node)", re: /import\.meta\.main/ },
  { why: "self-dispatch remnant: Bun.argv (undefined under Node)", re: /Bun\.argv/ },
];

const EXPECTED_SHEBANG = "#!/usr/bin/env node";

function linesAround(text, index) {
  const upto = text.slice(0, index);
  const line = upto.split("\n").length;
  return line;
}

function main() {
  let text;
  try {
    text = readFileSync(BUNDLE, "utf8");
  } catch (err) {
    console.error(`verify-node-bundle: cannot read ${BUNDLE}`);
    console.error(`  ${err && err.message ? err.message : String(err)}`);
    console.error("  Did the bundle build step run first?");
    process.exit(1);
  }

  const failures = [];

  // 1. Shebang must be the node shebang (tolerate trailing CR / whitespace).
  const firstLine = (text.split("\n", 1)[0] ?? "").replace(/[ \t\r]+$/, "");
  if (firstLine !== EXPECTED_SHEBANG) {
    failures.push(
      `shebang mismatch: first line is ${JSON.stringify(firstLine)}, expected ${JSON.stringify(EXPECTED_SHEBANG)}`,
    );
  }

  // 2. No Bun-only imports / self-dispatch remnants.
  for (const { why, re } of FORBIDDEN) {
    const m = re.exec(text);
    if (m) failures.push(`${why} [${re}] at line ${linesAround(text, m.index)}: ${JSON.stringify(m[0])}`);
  }

  if (failures.length > 0) {
    console.error(`verify-node-bundle: FAILED — ${BUNDLE} is not Node-safe:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  const kib = (Buffer.byteLength(text) / 1024).toFixed(1);
  console.log(`verify-node-bundle: OK — ${BUNDLE} is Node-safe (${kib} KiB, node shebang present)`);
}

main();
