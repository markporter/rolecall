---
title: Development
---

Local development uses Bun directly against the TypeScript sources under `src/`. Install dependencies once from the lockfile with `bun install`, which refuses to rewrite `bun.lock` in CI thanks to `--frozen-lockfile`. From there you can invoke the CLI straight from source either as `bun run src/cli/index.ts <args>` or through the `bin/rolecall.js` shim as `bun bin/rolecall.js <args>`. package.json aliases the former as `dev`, so `bun run dev --help` prints identical output to the shim.

Every change should pass two gates before you consider it done. Run `bun test` for the primary assertion suite, then `bun run build`, which simply forwards to `bunx tsc --noEmit` to confirm types hold. Both ship as npm scripts named `test` and `build`, keeping the commands stable regardless of who runs them. Native-binary builds live outside this loop behind `npm run build-bin`, which calls `node scripts/build-bin.mjs`.

The whole setup stays Bun-first for development, but the product now runs on Node too: the npm channel ships a Node bundle (`lib/cli.js`) built by `bun run build:js`, and `prepack` runs that build automatically. Plan your toolchain around Bun 1.4.2 or newer for working in this repo, and Node >= 22.19.0 for the published package. See [/contributing/testing](/contributing/testing) for how the same sources get exercised under both runtimes in CI.
