# 0030 — Project scaffolding: `rolecall project create` / `project init`

- Status: **Proposed**
- Date: 2026-11-14
- Related: [ADR 0014](0014-project-and-plugin-architecture.md) (folder-project shape, `plugins/<type>/<namespace>/`), [ADR 0015](0015-collections-and-install-commands.md) (`collections.yml`, `collections/`), [ADR 0021](0021-remote-git-project-source.md) (remote git project source — deliberately separate), [ADR 0023](0023-installation-layout-and-service-model.md) (wizard/flag convention this mirrors), [ADR 0025](0025-local-execution-isolation.md) (project-local `.rolecall/isolation.yaml` is advisory)

## Context

RoleCall documents a project layout but has no command to create one. A new user must
read `docs/content/concepts/project.md` / `docs/content/guide/project-structure.md` and
hand-write `rolecall.yaml`, `playbooks/`, `inventory/`, `plugins/`, `roles/`, and
`collections/`. `design/goals.md` lists scaffold tooling (`--create-project`) as planned;
no such command, flag, or handler exists in `src/`.

What already exists, and constrains this ADR:

- **The layout is already documented and stable.** `docs/content/concepts/project.md` and
  `docs/content/guide/project-structure.md` define `rolecall.yaml` (`name:` only — no
  dependency list), `playbooks/`, `inventory/`, `plugins/<type>/<namespace>/`, `roles/`,
  `group_vars/`, `host_vars/`, and vendored `collections/<org>/<coll>/`. ADR 0014 defines
  the uniform folder-project shape and the five plugin type directories; the scanner
  (`src/modules/scanner.ts`) already discovers `plugins/<type>/<namespace>/<name>.{ts,js}`.
- **`rolecall.yaml` is documentation-only today.** No source file parses it. This ADR does
  not introduce a parser; the scaffold writes the documented shape (`name:`).
- **`collections.yml` is designed but not implemented.** ADR 0015 §1 defines it; there is
  no reader. The scaffold writes a commented placeholder, not a claimed-working manifest.
- **The project-local isolation stub is already parsed.** `loadProjectRequest`
  (`src/isolation/config.ts`) reads `.rolecall/isolation.yaml` as *advisory* grants/egress
  (`grants`/`egress`, never auto-applied; promoted with `rolecall isolation allow
  --from-request`). A file with `version: 1` and no lists parses as empty.
- **There is a wizard precedent.** `runInstallCommand` (`src/cli/commands/install.ts`)
  detects a TTY, accepts an injectable `ask`, pre-answers prompts from flags, and honors
  `--yes`/`--non-interactive`/`--dry-run`. This ADR reuses that shape.
- **`--project DIR` already exists but means something else.** In `GLOBAL_OPTS` it locates
  a project for `rolecall isolation ...`; it is not a project-management command.
- **Remote sourcing is a separate decision.** ADR 0021 defines `--project <git-url>` and
  `GitProjectSource`. This ADR is local-filesystem-only and composes with it later rather
  than duplicating clone/materialization.

The command surface must also respect the existing dispatch (`src/cli/index.ts` `main`
switch on `[cmd, sub, ...rest]`), the single `GLOBAL_OPTS` parse, and the `CliResult` /
output-plugin rendering used by every command.

**Prior art this ADR borrows from (selectively).** Scaffolder UX is well-trodden:
`create-react-app`/`create-vite`/`next create` (template pickers, printed next steps, a
named `create` command run via `npx`, refuse-non-empty with an overwrite prompt), `cargo
new` vs `cargo init` (create-a-directory vs scaffold-in-place, and an opt-in `--vcs`),
`npm init` (defaults in prompts, `-y`), `ansible-galaxy init` (a role/collection skeleton
with `--force`/`--offline`/custom skeleton), and `cookiecutter`/`yeoman` (arbitrary
template variables, `--no-input`, replay, subgenerators). We adopt the cheap, low-risk
parts now and defer the rest to §9 — with the explicit anti-patterns in §10.

## Decision

### 1. Commands: `project create` (named dir) and `project init` (in place)

`project` is a new top-level command dispatched as `case "project"` →
`runProjectCommand(sub, rest, flags)`. Two subcommands share one generator:

- **`rolecall project create <name> [--dir <path>] [--namespace <ns>] [--vcs none|git]`**
  creates a named project directory. `<name>` is a required positional written verbatim
  to `rolecall.yaml` (human-readable names allowed). `--dir <path>` is the **exact
  project root** (not a parent); otherwise the directory is `join(cwd, slug(name))`, so
  `create "My Site"` yields `./my-site/` with `name: My Site`.
- **`rolecall project init [--dir <path>] [--name <name>] [--namespace <ns>]
  [--vcs none|git]`** scaffolds into an existing (empty) directory — default `cwd` — for
  the common "I already made the directory" case. `--name` defaults to
  `basename(target)`; `--namespace` defaults to `namespaceSlug(name)`, and if that is not
  valid the user must pass `--namespace` explicitly. This mirrors `cargo init` /
  `create-vite .` while keeping `create`'s single explicit target as the default path.
- `create` (named directory) stays the primary/discoverable command; `init` is the
  in-place sibling, not the default. Both produce byte-identical trees for the same
  inputs.
- **No `--template` in this ADR.** One canonical skeleton (ADR 0014 shape); templates are
  deferred to §9.
- **`--namespace <ns>`** sets the namespace used for the generated `plugins/<type>/<ns>/`
  directories. Default is `namespaceSlug(name)` (§6).

### 2. Generated layout (canonical, from the documented project shape)

```
<target>/
  rolecall.yaml
  README.md
  .gitignore              # only with --vcs git
  playbooks/
    site.yaml
  inventory/
    inventory.yaml
  plugins/
    modules/<namespace>/.gitkeep
    connection_types/<namespace>/.gitkeep
    callbacks/<namespace>/.gitkeep
    inventory/<namespace>/.gitkeep
    facts/<namespace>/.gitkeep
  roles/.gitkeep
  collections/.gitkeep
  group_vars/.gitkeep
  host_vars/.gitkeep
  .rolecall/
    isolation.yaml
  collections.yml
```

- All five plugin type directories from ADR 0014 §2 are created (four are reserved by the
  scanner today), each under the project namespace.
- Empty directories carry a `.gitkeep` so the shape survives a `git init` without the
  scaffolder depending on git.
- The skeleton does **not** emit executable plugin code (no example `.ts`). A generated
  project must not silently introduce code whose `import` specifier (`rolecall/modules`)
  may not resolve outside the package; the scaffold points at
  `/reference/writing-a-plugin` instead.
- `README.md` is always written: it is the first thing a user reads and the cheapest way to
  keep the generated project self-documenting. `.gitignore` is written **only** with
  `--vcs git`.

### 3. Generated file contents

`rolecall.yaml` — names the project, per the documented manifest, with provenance as a
leading comment (not a new manifest field, since no parser exists yet):

```yaml
# Generated by rolecall <version> (template: default). Safe to edit.
name: <name>
```

`inventory/inventory.yaml` — a runnable localhost inventory (matches
`examples/local-smoke/inventory.yaml`):

```yaml
groups:
  all:
    hosts:
      - localhost
    vars:
      rolecall_connection: local
```

`playbooks/site.yaml` — a no-op play that runs on the local connection, so the generated
project is immediately runnable:

```yaml
- name: <name>
  hosts: all
  tasks:
    - name: Confirm the project runs
      module: debug
      args:
        msg: "<name> project is ready"
```

`README.md` — a short generated README (layout, run commands, docs links). Example:

```markdown
# <name>

Generated by `rolecall project create` (template: default).

## Run it

    rolecall inventory show inventory/inventory.yaml
    rolecall playbook run playbooks/site.yaml

## Layout

- `rolecall.yaml` — project manifest
- `playbooks/` — playbooks you run
- `inventory/` — hosts and groups
- `plugins/<type>/<namespace>/` — project-local plugins (FQCN form)
- `roles/`, `collections/` — reusable roles and vendored projects
- `group_vars/`, `host_vars/` — variables

See the project docs for details.
```

`.rolecall/isolation.yaml` — advisory stub, parseable by `loadProjectRequest`:

```yaml
# Advisory only — RoleCall never applies project requests automatically.
# Approve an entry with: rolecall isolation allow --from-request
version: 1
```

`collections.yml` — commented placeholder (ADR 0015 §1 shape; the parser is not
implemented yet, so no empty flow-style list is emitted):

```yaml
# Project dependency manifest (ADR 0015).
# Uncomment and edit to add collections, then run `rolecall collections install`.
# collections:
#   - name: myorg.networking
#     version: 1.2.0
#     source: git+https://github.com/myorg/rolecall-networking
```

`.gitignore` — written only with `--vcs git` (state and resolved working copies, never the
committed request/manifest files):

```gitignore
# RoleCall local state
.rolecall/state.db
.rolecall/state.db-*
.rolecall/cache/

# Resolved collection working copies (ADR 0015); a baked deploy may commit these instead.
collections/

node_modules/
*.log
```

All generated YAML is block style (no flow-style `{ }`/`[ ]`), per the repo's example
convention.

### 4. Interaction model: TTY wizard, every answer a flag

- **Non-TTY, `CI` env set, `--yes`, or `--non-interactive`:** never prompt. `<name>` must
  be resolvable (positional for `create`, `--name`/basename for `init`); otherwise it is a
  usage error (exit 2). CI detection (`process.env.CI` truthy, not `false`/`0`) prevents
  hung prompt jobs.
- **TTY, no `--yes`:** if the name is absent, prompt for it; then show the resolved plan
  (target path, namespace, files, vcs) and confirm before writing. A declined confirmation
  writes nothing and exits 0 with a "cancelled" result.
- `--dry-run` always prints the plan and writes nothing (same semantics as `install`).
- **Next steps are printed on success** (CRA/create-vite/cargo pattern): the target, then
  the exact commands to inspect and run, and — with `--vcs git` — the git follow-ups. The
  same `next_steps[]` array is part of the JSON result so scripts can consume it.
- Prompts use `readline/promises` via an injectable `ask` (exactly like
  `runInstallCommand`), so tests drive the wizard without a TTY.
- The command never reads/writes the durable store and never contacts the network.

### 5. Existing-target policy: refuse unless empty, `--force` rewrites known files only

- If the target does not exist → create it (`create`); `init` requires the target to exist.
- If the target exists and is **empty** → scaffold into it (both subcommands).
- If the target exists and is non-empty (including an existing `rolecall.yaml`) → **refuse**
  with a clear error (exit 1) and list the conflicting target. This is checked before the
  interactive confirmation.
- `--force` overwrites **only the exact scaffold-owned files** listed in §2/§3
  (`rolecall.yaml`, `README.md`, `playbooks/site.yaml`, `inventory/inventory.yaml`,
  `collections.yml`, `.rolecall/isolation.yaml`, `.gitignore` with `--vcs git`, plus
  `.gitkeep` files). It **never deletes** any file and never touches unknown playbooks,
  roles, plugins, or vars. If a scaffold path exists as the wrong type (e.g. a directory
  where a file is expected), it is an error even with `--force`.
- Running twice on a scaffolded project without `--force` is therefore a safe no-op
  *error*, not a destructive re-run.

### 6. Validation and naming

- **`<name>`:** non-empty, ≤64 chars, no `/`, `\`, NUL, leading `.`, or `..`. The manifest
  stores it verbatim (human-readable names are fine).
- **`slug(name)` (directory slug):** lowercased, spaces and non-slug characters → `-`,
  collapsed; must be a non-empty single path segment (no `/`, no leading `.`/`-`) so the
  default target cannot escape cwd. A name that cannot produce a valid directory slug
  requires an explicit `--dir`.
- **`<namespace>`:** default `namespaceSlug(name)` — lowercased, non-alphanumerics → `_`,
  collapsed, prefixed if it starts with a digit — and must match `^[a-z][a-z0-9_]*$` (the
  FQCN namespace is the directory segment; dots and hyphens are not allowed). If the
  result is invalid, an explicit `--namespace` is required.
- Target paths are resolved to absolute before the plan is printed.

### 7. Scope boundaries (explicit non-goals)

- **Local filesystem only.** No clone, no `GitProjectSource`, no cache (ADR 0021 owns
  that). `--from <git-url>` can be added later as a composition (§9).
- **No serve-store registration.** Neither subcommand inserts a `Project` row; serve mode
  keeps its own `POST /api/projects` path.
- **No implicit VCS.** `--vcs none` is the default; no repository or ignore rules are
  written unless the user passes `--vcs git` (which runs `git init` through the PAL spawn
  seam and writes `.gitignore`). A missing `git` is a typed error; if `git init` fails, the
  generated files remain and the command reports how to finish manually — it does not roll
  back the scaffold.
- **No executable code generated.** See §2.
- **No dependency resolution.** `collections.yml` is written but not installed; that is
  ADR 0015's `rolecall collections install`.

### 8. Result contract

- New handler `src/cli/commands/project.ts` returns a `CliResult` with
  `command: "project create" | "project init"` and data `{ target, name, namespace, vcs,
  created[], overwritten[], skipped[], next_steps[] }`; it renders under `human_summary`
  (tree + next steps) and `-o json`. Exit 0 on success/cancel, 2 on usage error, 1 on
  refusing a non-empty target, a `git init` failure, or a filesystem failure.
- `GLOBAL_OPTS` gains `dir`, `name`, `namespace`, and `vcs` (all `string`); the HELP string
  gains both `project create` and `project init` lines; the CLI barrel re-exports the
  handler like the other commands.

### 9. Additive roadmap (designed for, not shipped in this ADR)

These are the deferred ideas from §Prior art, in rough priority order. None require a
rework of the generator if the plan/apply split and the flag namespace are respected.

- **Template presets** (`--template`, `--list-templates`): `local` (this skeleton), `ssh`
  (placeholder host group), `blank` (no runnable play), `ansible-convert` (post-conversion
  hand-off layout). Versions pinned to the binary; `--list-templates` is discovery.
- **Composable feature flags** (`rails --skip-*`, `dotnet new` switches): `--with-role`,
  `--with-module`, `--connection local|ssh`. More flexible than a template matrix and
  composable with presets.
- **Incremental generators** (`project add module|role|playbook`): the same renderer scoped
  to an existing project, so users never hand-copy boilerplate later.
- **Post-scaffold validation** (`--check`): run `inventory show` and `playbook run
  --check` on the generated project and report pass/fail — useful for CI-authored
  projects.
- **Replay / no-input defaults** (cookiecutter `--replay`): persist answered inputs to
  `.rolecall/create.json` so re-scaffolding or `project upgrade` is deterministic.
- **`project upgrade --dry-run`**: re-render the skeleton and print a diff against the
  existing tree, so users can adopt template changes without a one-way eject.
- **Local/URL template sources** (`--from-dir`/`--from-git`, cookiecutter/yeoman): gated by
  ADR 0021's trust boundary and ADR 0025's isolation, because templates can ship
  executable plugins.
- **`project list|show|delete`**: the rest of the `project` namespace.
- **Interactive picker UI** (`@clack/prompts`, as create-vite uses) for template/connection
  selection — only if it earns its dependency over the existing `node:readline` wizard.

### 10. Anti-patterns consciously avoided

Drawn from the scaffolder ecosystem's failures:

- **One-way "eject"** (create-react-app): never detach users into an unmaintainable fork.
  Generated files are plain and the roadmap's `project upgrade --dry-run` offers a diff
  path instead.
- **A hidden build/config layer in generated output** (CRA's webpack blob): the generated
  `rolecall.yaml`/playbooks are the real source of truth; no indirection.
- **Fetching templates or dependencies from the network implicitly** (`create-*`): the
  generator is bundled and deterministic; remote templates require an explicit flag and a
  trust decision.
- **Silent template drift**: pin the skeleton to the binary version, stamp provenance, and
  test the generated tree — so an update is visible, not surprising.

## Alternatives considered

- **Only `project init` / top-level `rolecall init`.** Rejected: the serve-mode `Project`
  noun and a named `create` command are clearer, and `init` alone makes "where did these
  files land" ambiguous. Both are shipped as siblings (create = named dir, init = in
  place) rather than forcing one.
- **In-place scaffolding as the default** (Ansible-style). Rejected as the *default*: a
  typo'd path would scatter files in cwd. It is offered explicitly as `project init`.
- **`--create-project` as a flag on `playbook run` (the current `design/goals.md` label).**
  Rejected: scaffolding is not part of execution, and a flag on `playbook run` makes
  "create then run" a hidden mode with no plan/confirmation surface. A real subcommand is
  discoverable, testable, and JSON-renderable.
- **Built-in template set (`blank`/`local`/`ssh`/...) now.** Rejected for this ADR: more
  files, docs, and tests to keep correct; one canonical skeleton already matches the
  documented layout. Templates are additive later (§9).
- **Overwrite everything with `--force`, or merge silently.** Rejected: destructive and
  surprising. `--force` is narrowly scoped to known scaffold files; unknown user content
  is never touched.
- **Clone a starter repo instead of generating files.** Rejected for the default: adds a
  network/trust dependency (ADR 0021) to the first-run experience and makes the generated
  content unauditable. Generation is local and deterministic.
- **`git init` by default.** Rejected: creating a repository is a user decision. It is
  opt-in via `--vcs git`, matching `cargo new --vcs`.
- **Emit an example TypeScript module.** Rejected: it introduces executable code and an
  `import` specifier that may not resolve from a standalone project; documentation is the
  right place for the module example.

## Consequences

**Positive**
- A new user gets a documented-shaped, immediately runnable project in one command
  (`rolecall project create my-site` → `rolecall playbook run playbooks/site.yaml`), with
  printed next steps and a generated README so the project is self-documenting.
- `project init` covers the existing-directory case without making in-place scaffolding the
  default.
- The generator encodes the ADR 0014/0015 layout in exactly one place, so layout drift is
  caught by tests rather than by user bug reports.
- The `--dry-run` plan and JSON result (including `next_steps`) make it scriptable and
  testable without a TTY; CI detection prevents hung prompts.
- Opt-in `--vcs git`/`.gitignore` prevents state DBs and resolved collections from being
  committed without silently creating a repo.
- Provenance plus a plan/apply split make a future `project upgrade --dry-run` feasible.
- The scaffold is advisory-only with respect to isolation and dependencies: it writes
  inert stubs that the existing loaders already understand, and creates no code.
- Remote sources (ADR 0021) and collections (ADR 0015) remain independently composable.

**Negative / risk**
- One more CLI surface to keep in the four-surface sync (`AGENTS.md`, `README.md`,
  `design/`, `docs/`), and now two subcommands to document/test.
- `rolecall.yaml` and `collections.yml` are written before their parsers exist; the
  generated files are documentation-shaped, and the docs must not imply the manifest is
  consumed until that lands. Provenance lives in a comment to avoid inventing a schema.
- "Refuse non-empty unless `--force`" means scaffolding into an existing repo requires an
  explicit `--force` (or `project init` on an empty dir); this is deliberate (fail closed)
  but will surprise some users.
- `--vcs git` adds a git-CLI dependency and an external process; it must fail cleanly and
  never leave a half-configured repo impression.
- A canonical skeleton is opinionated (localhost inventory, `debug` no-op play); users
  who want SSH or an empty skeleton must edit or wait for templates.

## Work items
- [ ] Add `src/cli/commands/project.ts` with `runProjectCommand(sub, rest, flags)`; pure
  `buildProjectPlan(...)` + `applyProjectPlan(...)` split so the plan is unit-testable and
  `create`/`init` share one generator.
- [ ] Add `project create` and `project init` to the HELP string and dispatch `case
  "project"` in `src/cli/index.ts`; add `dir`, `name`, `namespace`, `vcs` to `GLOBAL_OPTS`;
  re-export the handler from the CLI barrel.
- [ ] Implement TTY wizard (injectable `ask`, `--yes`/`--non-interactive`/`--dry-run`, `CI`
  detection), name/namespace validation, target-exists/`--force` policy, next-steps output,
  and the `CliResult` shape.
- [ ] Implement `--vcs git`: `git init` through the PAL spawn seam, write `.gitignore`,
  typed error when `git` is absent, and clear non-rollback messaging on failure.
- [ ] Tests: empty dir for both subcommands, non-empty refusal, `--force`
  overwrite-known-only, `--dry-run` writes nothing, non-TTY/CI missing name → exit 2, JSON
  output incl. `next_steps`, no `.gitignore` without `--vcs git`, `--vcs git` writes it,
  and that the generated tree loads (`inventory show`, and `playbook run` on the generated
  localhost playbook).
- [ ] Dual-runtime tests per ADR 0018 (`ROLECALL_RUNTIME=bun` and `=node`); `bun run build`
  must stay clean.
- [ ] Four-surface sync once implemented: `AGENTS.md` (commands + status), `README.md`,
  `design/` (this ADR, `design/README.md` map, `design/goals.md` — replace the stale
  `--create-project` label), `docs/content/{concepts/project.md,guide/project-structure.md}`
  plus a `project create`/`init` reference page and the new `README.md`/`--vcs` behavior;
  regenerate embedded docs (`bun run build`).
- [ ] (Follow-ups, separate ADRs) §9 roadmap: templates + `--list-templates`, feature
  flags, `project add`, `--check` validation, replay, `project upgrade --dry-run`, remote
  template sources, and `project list|show|delete`.

## References
- `src/cli/index.ts` (`HELP`, `GLOBAL_OPTS`, `main` dispatch, CLI barrel)
- `src/cli/commands/install.ts` (TTY wizard + injectable `ask` + `--yes`/`--dry-run` pattern)
- `src/cli/types.ts` (`CliResult`, `GlobalFlags`), `src/cli/output.ts` (renderers)
- `src/modules/scanner.ts` (plugin type/namespace discovery the layout must match)
- `src/isolation/config.ts` (`loadProjectRequest`, advisory `.rolecall/isolation.yaml`)
- `examples/local-smoke/{playbook,inventory}.yaml` (localhost shape the scaffold mirrors)
- `docs/content/concepts/project.md`, `docs/content/guide/project-structure.md`
  (the documented layout this command must generate)
- Prior-art scaffolders referenced for UX ideas: `create-react-app`, `create-vite`,
  `cargo new`/`cargo init`, `npm init`, `ansible-galaxy init`, `cookiecutter`, `yeoman`
- ADR 0014 (folder-project), ADR 0015 (`collections.yml`), ADR 0021 (remote source),
  ADR 0023 (wizard convention), ADR 0025 (advisory project isolation requests)
