# 0002 — Embed docs + version for single-file binary

- Status: **Accepted**
- Date: 2026-09-18
- See commit `bb7041a`.

## Context
We wanted `rolecall` to run as a **true single-file executable** (`bun build --compile`)
with no Bun runtime, `docs/`, or `package.json` present at runtime. Two reads used
`import.meta.url`-relative paths (`getVersion()` read `package.json`; `searchDocs`
read `docs/content/**/*.md`) which break inside a compiled binary (paths resolve into
Bun's temp-extraction dir where siblings aren't extracted).

## Decision
- Bundle `package.json` via `import pkg from "../../package.json"` (needs
  `resolveJsonModule: true` in tsconfig); `getVersion()` returns `pkg.version`.
- Generate `src/docs/embedded-content.ts` (a `Record<string,string[]>` map) at build
  time via `scripts/embed-docs.ts`; `searchDocs` reads the embedded map first, falling
  back to the disk walk only when empty (dev safety).
- Wire `embed:docs`, `build`, and `compile` npm scripts so embedding always precedes
  `tsc --noEmit` and the compile step.

## Consequences
- The compiled binary is fully self-contained (`--version` and `docs search` work with
  no source tree). Verified: `/tmp/rolecall-bin --version` → `rolecall 0.0.0`; `docs search`
  returns hits run from a directory with no `docs/`.
- Added a build-time generation step and a generated, committed file
  (`embedded-content.ts`).
- The orchestrator's sqlite store is created at a runtime user path, so it was
  unaffected (not read from the binary).
