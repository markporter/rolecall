---
name: documentation
description: Keep RoleCall API reference, VitePress user guide, and OpenAPI spec in sync with source after any public-surface change.
triggers:
  - update-docs
  - docs-sync
  - api reference
  - refresh-docs
---

# Documentation (RoleCall)

Keep the generated API reference, the VitePress user guide, and the server-mode
OpenAPI spec aligned with `src/` whenever you touch a public surface. This loop is
invoked from the "# For agents coding RoleCall" section of repo-root `AGENTS.md` via
`skill(name="documentation")`; read that section first for the test and type-check
gates that bracket this work.

## When to run

Run this loop after any of:

- Adding or changing a public export (function, type, interface, enum) that shows
  up under `docs/api`.
- Editing exported signatures or their `@summary` / `@param` text.
- Changing the CLI help string or global flags in `src/cli/index.ts` (surfaced in
  the command-reference pages).
- Registering new routes in `src/orchestrator/routes.ts` (surfaced in the OpenAPI
  spec and served at `/docs.json`).

## Quick start

Two commands rebuild the static artifacts:

```sh
bun run docs:api          # TypeDoc -> docs/api   (config in typedoc.json)
cd docs && bun run build  # VitePress -> docs/.vitepress/dist
```

Then confirm nothing broke behind them:

```sh
bun test
ROLECALL_RUNTIME=bun bun test
ROLECALL_RUNTIME=node bun test
bun run build             # -> bunx tsc --noEmit, must exit 0
```

Note on the VitePress build: never pass `--bun`. Running VitePress under Bun hits
the crypto.getRandomValues regression vuejs/vitepress#4711, so Node >= 22 is pinned
for this reason. Run plain `bun run build` inside `docs/` (that script is
`vitepress build`).

## Step-by-step

1. Detect changed surfaces. Diff your commits against `main`. List every touched
   public export in the CLI barrel and other `index.ts` files, any edited
   `@summary` / `@param`, any HELP-string or flag change in `src/cli/index.ts`, and
   any route added to `src/orchestrator/routes.ts`. Do not assume; record what
   actually moved.

2. Regenerate the API reference. Run `bun run docs:api` (TypeDoc reads
   `typedoc.json`, whose entry points cover `src/cli`, `src/modules`,
   `src/orchestrator`, `src/store`, `src/config`, `src/transport`,
   `src/util/runtime`). Commit the regenerated `docs/api` so signatures and comments
   track source.

3. Refresh the guide where behavior changes. Update the relevant markdown under
   `docs/content/<section>/...md` (command-reference, global-options, serve-command,
   etc.) so prose matches the current `--help` output. Skip untouched pages.
   **Example style (YAML block only — no flow style):** every task/module example in
   `docs/content`, in `src/*` module `meta.examples` strings, and in any skill/agent
   guidance MUST use YAML block style. There is **no flow-style `{ … }` or `[ … ]`
   anywhere in an example** — every mapping and sequence (including nested structured
   refs like `$each`/`$concat`/`$eq`/`$var`/`$and`, and `when:`/`loop:`/`that:`/`block:`)
   is indented with one entry per line. Banned: `args: { … }`, `loop: { $each: { … } }`,
   `block: { $concat: [ … ] }`, `that: { $and: [ … ] }`, `- { $eq: [ … ] }`, etc.
   Module `examples` arrays MUST be backtick template literals (multiline), never
   single-line `"\n"`-escaped strings. When you touch a module's `examples`, run
   `bun run build` so `docs/content/reference/module-reference.md` and the embedded
   content stay in block style.

4. Update the OpenAPI spec module and keep it in step with the route registry.
   Whenever `mountRoutes` registers a new path, regenerate the shared OpenAPI spec
   built from that route registry so its paths and methods match exactly, with no
   phantom entries. Verify `/docs.json` stays in sync with the route registry: boot
   the serve app on an ephemeral port and check that `/docs.json` still parses as
   valid OpenAPI 3.0 and covers every registered endpoint (`/health`, `/status`,
   `/run`, `/runs/:id/status`, `/projects`, `/schedules`) without missing or extra
   paths. Mark deferred auth/RBAC honestly rather than claiming they work.

5. Rebuild the site. Run `cd docs && bun run build` to produce
   `docs/.vitepress/dist`. Confirm the build exits cleanly.

6. Re-run tests and the type gate. Run `bun test`, then both
   `ROLECALL_RUNTIME=bun bun test` and `ROLECALL_RUNTIME=node bun test`, then
   `bunx tsc --noEmit` through `bun run build`. All three runtime variants and the
   type-check must stay green before you commit.

7. Watch the lockfile. If adding doc-only devDeps, the only expected `bun.lock`
   change is those documentation dependencies. Root `package.json` `files:` field
   stays untouched and no runtime dependency should sneak into the docs step.

## Honest status boundaries

Server mode is implemented: `src/orchestrator/routes.ts` mounts real endpoints, run
dispatch executes over real transports, and the cron scheduler plus webhooks are wired.
Two things stay partial: server dispatch uses a simplified per-target runner rather than
the full CLI `runPlaybook` executor, and the SPA UI is static-`--ui-dist`-only. The
executor, idempotency, transport, facts-collection, structured templating, cron, and
webhooks are implemented; Jinja `{{ }}` rendering, the SPA UI, serve-side executor
parity, the plugin-SDK authoring surface, Http/gRPC, and Postgres remain scaffolded or
partial. Document those boundaries honestly; never assert a scaffolded item applies
remote state.

## See also

- Repo-root `AGENTS.md`, "# For agents coding RoleCall": the test plus type-check gates
  that precede and follow this loop.
- `.omo/plans/documentation.md`: the documentation work plan (C1-C5 complete; later
  comps tracked there).
