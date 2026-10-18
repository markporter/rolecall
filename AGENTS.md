# RoleCall agent guidance

This file tells an AI assistant how to *use* RoleCall versus how to *change* RoleCall.
Pick the section that matches your role. Keep everything here grounded in
`src/cli/index.ts`; never invent a flag or subcommand that is not in the HELP
string or `GLOBAL_OPTS`.

## Alpha state (pre-0.1.0)

RoleCall is in **alpha** until the `0.1.0` release. During alpha, **breaking changes are expected** — make the change that is correct, do not block or defer it to avoid breaking existing playbooks, examples, or tests. The one non-negotiable: keep **examples and docs in sync with `src/`** as you develop (the four-surface sync discipline still applies). Breaking the code/contract is fine; letting docs or examples drift stale is not.

For **design context** (goals, roadmap, architecture, decisions) read the
[`design/`](design/README.md) folder — it is the "why/where-to" and is kept as plain
Markdown so agents can read it directly. For user-facing how-to/reference, read `docs/`.

## For agents using RoleCall

RoleCall is a dual-runtime config-management and orchestration CLI (`rolecall playbook run ...`)
and orchestrator server (`rolecall --serve`). Two distribution channels, one codebase:

- **npm = Node.js.** `npx rolecall` / `npm i -g rolecall` works on a machine with
  Node >=22.19.0 and no Bun. The published bin is `lib/cli.js`, a
  `bun build --target=node --packages=external` bundle produced by `bun run build:js`
  (`node scripts/build-js.mjs`); `prepack` runs it automatically so the baked version
  matches the release.
- **Bun = batteries included.** Compiled binaries (existing `scripts/build-bin.mjs`
  pipeline) and source-checkout dev (`bun bin/rolecall.js` still works, byte-identical;
  `bun run dev` unchanged). Bun's remaining value is binaries, dev ergonomics, and
  faster cold starts — the full feature surface works on both runtimes (ADR 0019).

Run from source:

```sh
bun run src/cli/index.ts --help     # usage
bun bin/rolecall.js --help               # same help via the source-checkout bin shim
bun run dev <args>                  # dev mode: runs src/cli/index.ts with your args
```

Installed on PATH (npm package, bin `rolecall` -> `lib/cli.js`; in a source checkout a
dev shim `rolecall` -> `bin/rolecall.js` may also exist):

```sh
rolecall --help
rolecall --version                       # short form: rolecall -v
rolecall playbook run playbook.yaml [--inventory <inv>] [--limit] [--force] [--check] [--diff] [--forks N] [--tags <list>] [--skip-tags <list>]
rolecall facts gather <inv> [--limit]
rolecall inventory show <inv>
rolecall inventory list <inv>
rolecall vars list <play>               # declared var/fact by file + fact capability per connection kind
rolecall vars trace <play> [--inventory <inv>] [--extra-vars <kv>] [--limit <host>]
rolecall docs search <query>            # query RoleCall prose docs by substring
rolecall plugin list                               # registered module/fact + built-in inventory plugins
rolecall plugin register <name> --path <file> [--global]   # persist a module kept outside a project (project plugins in plugins/ need no registration)
```

Runtime support matrix (verify against `src/pal/` before claiming more):

- **Works on Node** (npm install): `--help`/`--version`, `inventory show`/`list`
  (native + Ansible formats), `playbook run` over SSH (ssh2) and local transports,
  `facts gather`, `vars list`/`trace`, `docs search`/`docs modules`,
  `plugin list`/`register`, `agent manifest`, the `sql` builtin + idempotency
  cache, the durable SQLite store, and everything that boots it: `--serve`,
  `--trace`, `--profile`, `run replay`. The full feature surface works on both
  runtimes (ADR 0019). `node:sqlite` prints a one-time ExperimentalWarning to
  stderr on first use — expected.
- **Both runtimes**: the store opens a runtime-selected synchronous sqlite handle
  through the PAL (`bun:sqlite` under Bun, `node:sqlite` under Node) with the same
  schema, pragmas, and `BEGIN IMMEDIATE` read-modify-write fencing. The SSH PAL
  surface stays a stub on Node (product SSH goes through ssh2 directly and works
  on Node either way).

Subcommand reality (from the HELP string):

- `playbook run <file>` parses and resolves the inventory, then applies tasks live
   over SSH or local transports rather than merely printing a plan. Scheduled jobs,
   cron, webhooks, the SPA UI, and literal Jinja `{{ }}` templating remain scaffolded.
   The Plugin SDK now ships `plugin register`/`list` (module plugins persist and
   auto-load at startup); the richer SDK authoring/test harness is still partial.
   At startup it also scans project-local plugins under `plugins/<type>/<namespace>/`
   and dispatches them by FQCN (`<namespace>.<name>`) or an unambiguous bare alias,
   with builtins reserving bare names. Tags (`--tags`/`--skip-tags`) filter the
   resolved task list; play-level `handlers:` notify-flush at end of play.
- `facts gather <inv>` resolves target hosts and collects targeted/cached facts for
   each resolved host (graceful on unreachable ones) via the built-in engine.
- `inventory show <inv>` prints resolved hosts plus per-host vars.
- `inventory list <inv>` lists group names.
- The inventory loader accepts both RoleCall-native `groups:` YAML and Ansible
   inventories directly (auto-detected): `--inventory <file>`, `inventory
   show`/`list`, `facts gather <inv>`, and `vars trace --inventory` may point at a
   native YAML file, an Ansible INI file (`.ini`, or content whose first line
   starts with `[`), or an Ansible `all:`-rooted YAML file. Both Ansible forms
   normalize into the native shape (group `children` + a document-root `host_vars`
   map), and the engine resolves group vars with Ansible child-over-parent
   precedence and host vars on top.
- `vars list <play>` lists every declared var/fact grouped by declared-by file, with
   each var's layer/override status and (where known) the facts a connection kind can gather.
- `vars trace <play> [--inventory <inv>] [--extra-vars <kv>] [--limit <host>]` is the
   btool-style precedence trace: shows a var's full override chain from role-default up to
   `--extra-vars` with file/line provenance.
- `docs search <query>` queries `docs/content/**` prose docs by substring (`-o json` for
   structured output).
- `plugin list`/`register` are implemented: `register` persists a user module/fact
   plugin to `.rolecall/plugins.json` and it auto-loads at startup; only the richer SDK
   authoring/test harness remains partial (see ADR 0016).

Global flags (parsed once by `parseArgs`):

- `-o/--output human|json` selects the output plugin (default `human`).
- `--limit <hosts>` restricts targets to one pattern.
- `--inventory <file>` sets the inventory source (native `groups:` YAML or Ansible INI/`all:`-rooted YAML, auto-detected).
- `--force`, `--check`, `--diff` are accepted and honored during live application
   over SSH/local transports (they influence real convergence, not placeholders).
- `--forks <N>` concurrency fan-out, must be a number.
- `--tags <list>` / `--skip-tags <list>` (comma-separated) select/skip tasks by tag on
   `playbook run`; a task's own tags replace play tags, and tag-filtered tasks report
   as skipped.
- `-h/--help`, `-v/--version`.

Serve mode (`rolecall --serve`, see `src/orchestrator`; works on both runtimes —
the durable SQLite store it boots opens through the PAL):

```sh
rolecall --serve                         # boot the Express orchestrator
rolecall --serve --port 9090             # env ROLECALL_SERVE_PORT default 8080
rolecall --serve --host 0.0.0.0          # env ROLECALL_SERVE_HOST default 127.0.0.1
rolecall --serve --ui-dist ./build       # serve static UI dir (env ROLECALL_UI_DIST)
```

With no UI dist set, `GET /` returns a zero-build health JSON object instead of
serving pages. Routing works off the route registry, so scheduler triggers, cron,
webhooks, and the SPA UI remain scaffolded ("not yet implemented"): plan/trigger
endpoints accept work but do not run it today.

Honest status note: the genuinely-scaffold subsystems are templating (Jinja `{{ }}`
kept literal), Http transport (gRPC capability deferred), the orchestrator
scheduler/cron/webhooks/UI, and the richer Plugin SDK authoring surface. The executor,
the SSH/Local/Network transports, `facts gather`, `vars list`/`trace`, and `plugin
list`/`register` (module-plugin persistence + auto-load) are implemented; never claim any
scaffolded item above applies real remote state. The Node-runtime PAL is implemented
for the surfaces listed in the matrix above (sqlite/crypto/dns/spawn/file/http/
observability); the durable store runs on both runtimes over the PAL SqliteDb seam
(ADR 0019 — drizzle-orm removed).

## For agents coding RoleCall

**Dual-runtime tests.** The primary runner is the Bun-native `bun:test`:

```sh
bun test
```

Product source exposes two implementations per surface, selected by
`detectRuntime()` in `src/util/runtime.ts`. Always force both branches too:

```sh
ROLECALL_RUNTIME=bun bun test
ROLECALL_RUNTIME=node bun test
```

The suite imports `bun:test`, which plain Node cannot load without a loader we
deliberately avoid shipping, so these variants keep the `bun:test` runner while
exercising each detection branch. CI's `unit` job runs all three across Linux,
macOS, and Windows.

**Type-check gate.** Finish every change with:

```sh
bun run build      # -> bunx tsc --noEmit
```

`tsc --noEmit` must exit 0. Do not merge type errors, missing ambient
declarations, or stray unused identifiers past this step.

**Packaging scripts (do not reinvent).** The npm channel is built by
`bun run build:js` (`node scripts/build-js.mjs`): it regenerates the embedded docs,
bundles `scripts/cli-node-entry.mjs` (a build-only non-entry shim, so the
`import.meta.main` self-dispatch in `src/cli/index.ts` tree-shakes away) to
`lib/cli.js` with `bun build --target=node --packages=external`, and verifies the
bundle is Node-safe. `prepack` runs it automatically, so the baked version always
matches the release. Native binaries stay on the untouched `npm run build-bin`
pipeline (`node scripts/build-bin.mjs`), which writes to `dist/`.

**TSDoc-on-change.** Annotate public exports you add or touch with TSDoc tags
(`@summary`, `@param`, ...). TypeDoc reads them into `docs/api`. A worked example
already lives in `src/cli/index.ts`:

```ts
/** @summary Unified entrypoint: boots the orchestrator server when --serve is set, otherwise parses global flags and dispatches the requested subcommand handler. @param argv Command-line arguments (Bun.argv); slice(2) drops node/script paths. @returns Process exit code (0 ok, 1 runtime error, 2 usage/validation error). */
export async function main(argv: string[]): Promise<number> { ... }
```

Copy an adjacent comment if unsure about tag shape. "Public" means anything
re-exported from the CLI barrel or other index files.

**Docs-sync workflow.** When you change a public export or signature, or behavior
surfaced in the guide, update the site through the project-local skill
`skill(name="documentation")`. Its body walks regenerating the API, rebuilding
VitePress, refreshing the OpenAPI spec module against the route registry, and
verifying `/docs.json` stays in sync. Run that skill after editing `src/`.

**Four-surface sync discipline.** RoleCall's four user-facing surfaces must stay in lockstep
with `src/`: `AGENTS.md` (this file — the agent how-to/status authority), the top-level
`README.md` (project overview + feature-status summary), `design/` (goals/architecture/
roadmap/ADRs), and `docs/` (the published VitePress guide + API reference). When you ship
or change behavior, update **all four** surfaces the change touches — not just `docs/`.
The `Source-of-truth rule` still holds: `src/*` wins, and a stale surface is corrected to
match it.

**Source-of-truth rule.** `src/*` wins over prose docs. Documentation previously
understated implemented subsystems by labeling much of the engine "(later)" or
"[deferred]"; those claims have been corrected to match current `src/`, where
execution, transport, and facts collection now apply real state. Where a doc still
labels an area as scaffold while `src/` implements it, trust `src/` and update the
doc accordingly.

**Subsystem honesty.** Templating (Jinja `{{ }}` literals preserved verbatim),
Http transport (gRPC capability deferred), the richer Plugin SDK authoring surface
(module/plugin `register` persistence + auto-load are implemented — see ADR 0016),
and the orchestrator scheduler/cron/webhooks/UI are scaffolded and must not be
asserted as functional.
The executor, the SSH/Local/Network network transports, and facts-collection are
implemented and applied live; do not describe them as pending. The durable store
is dual-runtime (PAL SqliteDb seam, drizzle-orm removed — ADR 0019); Postgres
remains record-only/deferred.

**Example style (YAML block only — no flow style).** Every task/module example in
`src/*` module `meta.examples` strings, in `docs/`, and in any skill or agent
guidance MUST use YAML block style. This means **no flow-style `{ … }` or `[ … ]`
anywhere in an example** — every mapping and every sequence (including nested
structured refs like `$each`, `$concat`, `$eq`, `$var`, `$and`, `when:`, `loop:`,
`that:`, `block:`) is written with indentation and one entry per line:

```yaml
- blockinfile:
    loop:
      $each:
        $var: play.hosts
    path: /etc/hosts
    marker_id:
      $var: loop.item
    block:
      $concat:
        - 'host-'
        - $var: loop.item
    state: present
```

Banned (reads as JSON, never use in examples): `args: { … }`, `loop: { $each: { … } }`,
`block: { $concat: [ … ] }`, `that: { $and: [ … ] }`, `- { $eq: [ … ] }`, etc.
Write each nested mapping/sequence as its own indented block. Example arrays in
`src/*` MUST be **backtick template literals** (multiline), never single-line
`"\n"`-escaped strings — the cramped one-line form is what causes agents to fall
back into flow style. When you touch a module's `examples` or any doc example,
regenerate the reference (`bun run build`) so `docs/content/reference/module-reference.md`
and the embedded content stay in block style.
