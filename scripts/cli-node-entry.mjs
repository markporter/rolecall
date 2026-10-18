// scripts/cli-node-entry.mjs — BUILD-ONLY entrypoint for the Node ESM bundle.
// -----------------------------------------------------------------------
// This file is intentionally NOT shipped (it lives in scripts/, outside the
// published `files`); it exists only as the `bun build` entry that produces
// lib/cli.js. Do not delete it as "unused" — the packaging build needs it.
//
// WHY A SEPARATE ENTRY EXISTS (verified against this repo):
//   `src/cli/index.ts` ends with an `if (import.meta.main)` self-dispatch guard
//   that calls `main(Bun.argv)` so `bun run src/cli/index.ts` works directly.
//   `import.meta.main` is Bun-specific. When index.ts is itself the bundler
//   entry, that guard is compiled as a runtime check which is TRUE under Bun
//   but is also evaluated by the bundler as possibly-an-entry, so `Bun.argv`
//   survives into the output and the Node process auto-runs
//   `main(Bun.argv)` and crashes (Bun is undefined under Node).
//
//   Importing index.ts as a *non-entry* module (as done below) makes
//   `import.meta.main` statically false and tree-shakes the whole self-dispatch
//   block — including the `Bun.argv` reference — away, leaving a clean Node
//   bundle that only runs `main()` when we explicitly call it here with
//   `process.argv`.

import { main } from "../src/cli/index.ts";

const code = await main(process.argv);
process.exit(typeof code === "number" ? code : 0);
