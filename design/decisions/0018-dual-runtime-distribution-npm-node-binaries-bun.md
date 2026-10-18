# 0018 — Dual-runtime distribution: npm channel = Node.js, binaries = Bun

- Status: **Accepted**
- Date: 2026-10-18

> **Status note (2026-10-18):** the "Deferred on Node" list in section 5 below is
> superseded by [ADR 0019](0019-store-over-pal-sqlite-drop-drizzle.md) — the store
> now runs on both runtimes over the PAL SqliteDb seam, and drizzle-orm is gone.
> This body is kept append-only for history.

- Related: [ADR 0005](0005-io-abstractions-vfs-db-scratch.md) (IO abstractions / PAL seams), [ADR 0006](0006-storage-backend-colocation-and-postgres.md) (storage backends), [ADR 0014](0014-project-and-plugin-architecture.md) (project & plugin architecture), [ADR 0017](0017-execution-isolation-and-run-scope.md) (run scope)

## Context

RoleCall started Bun-first: `bun build --compile` binaries, `bun:sqlite` for the
durable store, and a PAL whose Node branch was a stub set that threw on use. That
blocked the most common install path — `npm i -g rolecall` on a plain Node machine —
and made the npm registry page promise a package that could not run without Bun.

The Node-runtime PAL is now implemented across its surfaces
(`src/pal/*.node.ts`: sqlite via `node:sqlite`'s `DatabaseSync`, crypto via
`node:crypto`, dns via `node:dns/promises`, spawn via `node:child_process`, file via
`node:fs/promises`, http via `node:http`, observability via `process.stderr`), and
the whole `bun test` suite is green under `ROLECALL_RUNTIME=node`. This ADR records
the distribution decision that builds on that work, the bundling mechanics that make
it possible, and the honest defer list that remains.

## Decision

### 1. Two distribution channels, one codebase

- **npm channel = Node.js.** The published package targets Node >= 22.19.0 with no
  Bun installed: `npx rolecall` / `npm i -g rolecall`. The published bin is
  `lib/cli.js`; package.json `files` is `["lib", "README.md"]` (raw `src/` no longer
  ships; `dist/` stays reserved for release binaries). The tarball is 3 files,
  ~732 kB packed / ~2.8 MB unpacked (inline sourcemap).
- **Bun = batteries included.** The existing `scripts/build-bin.mjs` compiled-binary
  pipeline is untouched, and source-checkout dev is unchanged (`bun
  bin/rolecall.js` is byte-identical in behavior; `bun run dev` still runs
  `src/cli/index.ts` directly). `bin/rolecall.js` is a source-checkout shim only —
  it is not what npm installs.

### 2. Bundling: `bun build --target=node --packages=external` via a non-entry shim

`bun run build:js` (`node scripts/build-js.mjs`) produces `lib/cli.js` in three
steps: regenerate the embedded docs corpus, bundle `scripts/cli-node-entry.mjs` with
`bun build --target=node --packages=external --sourcemap=inline` plus a
`#!/usr/bin/env node` banner, then run the Node-safety guard
(`scripts/verify-node-bundle.mjs`). `--packages=external` keeps third-party packages
as runtime imports — they are real `dependencies`, not inlined.

**Why a build-only non-entry shim** (`scripts/cli-node-entry.mjs`, not shipped):
`src/cli/index.ts` ends with an `if (import.meta.main)` self-dispatch that calls
`main(Bun.argv)`. When `index.ts` is itself the bundler entry, `import.meta.main`
compiles to a runtime check that is true under Bun but still lets `Bun.argv` survive
into the output, so the Node process auto-runs `main(Bun.argv)` and crashes (`Bun`
is undefined under Node). Importing `index.ts` as a *non-entry* module makes
`import.meta.main` statically false and tree-shakes the whole self-dispatch block —
`Bun.argv` included — leaving a clean Node bundle that calls `main(process.argv)`
explicitly.

**Why not `tsc` emit:** the TypeScript sources use extensionless relative imports
(which NodeNext emit would need rewritten to `.js`), Bun-specific `import.meta.main`,
and top-level await. All three make a plain `tsc` emit a larger, riskier migration
than bundling, for no gain — the bundle is the artifact, not emitted source.

### 3. The createRequire-only laziness rule (load-bearing)

Any bun-only module value import must be obtained lazily via `createRequire`, never
via dynamic `import()`. A dynamic `import()` of a bun-only specifier is **hoisted by
the bundler** into the Node bundle, which then fails at load time under Node — the
hoisting makes it equivalent to a static import, so it is *not* a laziness tool.
`createRequire(import.meta.url)("bun:sqlite")` is only evaluated when a DB is
actually opened, so the module stays import-safe under both runtimes. This rule is
what lets the PAL barrel statically import both implementation sets
(`*.bun.ts` + `*.node.ts`) and select between them at `getPAL()` time. Do not
"modernize" these `createRequire` calls into `import()`; that breaks the Node bundle.

### 4. Engines floor: `node >= 22.19.0`, `bun >= 1.4.2`

- **p-retry@8** requires Node >= 22, and it is a runtime dependency.
- **`node:sqlite`** (the Node SQLite PAL) is unflagged since Node 22.13; 22.19 is the
  floor the package declares so the unflagged surface is guaranteed.
- **Node 20 is EOL**, so supporting it buys nothing.
- **undici does not constrain the floor**: it is a devDependency and is not imported
  by product code (comment-only reference).

### 5. Deferred on Node (by design, clean error)

The durable SQLite store uses the drizzle-orm/bun-sqlite dialect, which needs a real
`bun:sqlite` handle. Under Node it throws
`"SQLite backend is not available under the Node runtime (deferred past MVP)"`, and
therefore `--trace`, `--profile`, `run replay`, and `rolecall --serve` are Bun-only
for now. The SSH PAL surface stays a stub on Node; product SSH goes through ssh2
directly and works on Node either way. The `sql` builtin and the idempotency cache
work on Node through the SQLite PAL (`node:sqlite`; prints a one-time
`ExperimentalWarning` to stderr on first use — expected).

### 6. Acceptance gate

CI gains a `node-package-smoke` job (added separately to
`.github/workflows/ci.yml`): it packs the tarball, installs it, and runs the CLI
with `bun` stripped from `PATH`, proving the npm channel is genuinely Node-only. The
existing `unit` and `native` jobs are unchanged.

## Consequences

**Positive**
- `npm i -g rolecall` works on a stock Node >= 22.19 machine; the registry package
  finally matches its own advertisement.
- The Bun-native paths (binaries, source checkout, store, serve) are unchanged.
- The PAL barrel stays simple: both implementation sets load under both runtimes.

**Negative / risk**
- Two artifacts must stay in sync with one source tree; `prepack` mitigates drift
  for the version, and `scripts/verify-node-bundle.mjs` guards Node-safety.
- The store/serve Bun-only split is a real product limitation users will hit; docs
  must keep stating it plainly until a Node-capable store dialect lands.
- The createRequire-only rule is invisible to type checking; a future dynamic
  `import()` of a bun-only module would only fail at Node load time (the CI smoke
  job is the backstop).

## References
- `scripts/build-js.mjs`, `scripts/cli-node-entry.mjs`, `scripts/verify-node-bundle.mjs` (Node bundle pipeline + guard)
- `src/pal/index.ts` (getPAL runtime selection), `src/pal/*.node.ts` / `src/pal/*.bun.ts` (implementation sets), `src/pal/sqlite.bun.ts` + `src/pal/sqlite.node.ts` (createRequire laziness)
- `src/util/runtime.ts` (detectRuntime + `ROLECALL_RUNTIME` override)
- `src/store/store.ts` (Node store error), `package.json` (engines/files/bin/prepack)
- ADR 0005 (PAL seams), ADR 0006 (storage backends), ADR 0017 (run scope)
