# 0021 — Remote git project source (materialize, then read)

- Status: **Proposed**
- Date: 2026-11-01
- Related: [ADR 0004](0004-serverless-and-git-friendly.md) (git-backed projects as a target capability), [ADR 0005](0005-io-abstractions-vfs-db-scratch.md) (the `ProjectSource` seam this fills in), [ADR 0014](0014-project-and-plugin-architecture.md) (folder-projects; §8 trust boundary), [ADR 0015](0015-collections-and-install-commands.md) (dependency hydration — deliberately separate), [ADR 0018](0018-dual-runtime-distribution-npm-node-binaries-bun.md) (dual-runtime obligations), [ADR 0020](0020-mcp-server-and-tool-surface.md) (authoring tools already write through the VFS seam)

## Context

RoleCall can only read a project from local disk. `FsProjectSource`
(`src/vfs/fs-project-source.ts`) is the sole `ProjectSource` implementation, and the
project root is derived from the playbook's path — the playbook's directory, or its parent
when the child holds `plugins/`/`collections/` (`src/cli/commands/playbook.ts:56-63`).
Every read seam already accepts a `ProjectSource` (`src/config/loader.ts`,
`src/inventory/plugin.ts`, `src/executor/module.ts`), so the abstraction exists; the git
backend does not.

The adjacent pieces are variously reserved, deferred, or scoped to something else:

- `ROLECALL_PROJECT_GIT_URL` is parsed into `Config.projectGitUrl`
  (`src/config/env.ts:37-38,88`) but **has no consumer anywhere in `src/`**. Setting it
  changes nothing.
- `GitProjectSource` is named as designed-in/deferred in
  `src/vfs/project-source.ts:5-8`, `design/vfs-and-io-abstractions.md:32`, and
  `design/serverless-and-git-friendly.md:60-61` (Phase 1). No code exists.
- ADR 0015's `collections.yml` + `rolecall collections install` fetches **dependency
  projects** into `collections/`; it is not a mechanism for "run this repo as the
  project." Neither the manifest parser nor the command is implemented.
- The builtin `git` module (`src/modules/builtins/git.ts`) clones/updates a repository
  **on the target host** over Local/SSH; it is an execution module, not a project source.
- Serve-mode projects persist only an absolute filesystem `path`
  (`src/store/types.ts:15-22`); there is no repo/ref field and no clone step.

So today the only working answer is "clone it yourself, `cd` into the checkout, run
`rolecall playbook run …`." That works (and stays supported), but it is undocumented
tribal knowledge, it breaks relative `imports:` when not run from the repo root because
`runPlaybookCommand` calls `loadPlaybookFile(file)` with no source
(`src/cli/commands/playbook.ts:48` → `src/config/loader.ts:852` defaults to
`FsProjectSource(cwd)`), and it cannot express "this project comes from git" to the
orchestrator. This ADR makes the remote-project case a first-class selection.

## Decision

### 1. A git project source is **materialized, then read** — not a virtual FS

`GitProjectSource` clones/fetches the selected URL+ref into a local cache directory and
then delegates every `ProjectSource` member to an `FsProjectSource` rooted at that
checkout. It does not implement a read-only virtual filesystem over git objects.

The seam itself forces this choice: `resolveImportablePath` must return an **absolute
filesystem path** so `import()` can load user modules (`src/vfs/project-source.ts:29-36`,
`src/executor/module.ts`), and ADR 0014's JIT bundling path needs a writable tree to emit
`_bundled.js`/`node_modules`. A virtual source would still have to materialize a temp
copy for those two call sites while diverging from disk for every other read — more
machinery for less fidelity.

### 2. Cache and materialization semantics

- **Cache root:** `ROLECALL_PROJECT_CACHE` when set, else
  `~/.rolecall/cache/projects/` (honoring `ROLECALL_HOME`, ADR 0005 conventions).
- **Key:** `<hash(url + "\\0" + ref)>`, storing a small `source.json` (url, requested ref,
  resolved commit, fetchedAt) beside the checkout. The resolved commit — not the ref
  name — is the content identity, so a moving branch can be detected and refreshed.
- **Clone:** shallow (`--depth 1`) by default; `--depth <n>`/full when the user asks.
  `ref` is a branch, tag, or commit. On a cache hit with a matching resolved commit the
  source is used with no network. On a moving ref, fetch + checkout.
- **Atomicity:** clone into `<key>.tmp-<rand>` and `rename()` into place under a lock so
  a concurrent or interrupted run never exposes a half-written checkout. A per-key lock
  serializes concurrent materialization (the same `BEGIN IMMEDIATE`-style discipline the
  store uses, applied to the filesystem).
- **Refresh/offline:** `--refresh` forces a re-fetch; `--offline` uses the cached
  checkout and errors clearly if absent. Never clone implicitly when offline or when the
  cache is read-only.
- **No credentials stored:** authentication is delegated to the git CLI (ssh agent,
  `GIT_ASKPASS`, credential helpers, HTTPS tokens in the environment). RoleCall persists
  no secrets, and redacts any userinfo in a URL before logging it.

### 3. Selection surface: explicit, flag-first, env-compatible

- `rolecall playbook run <file> --project <git-url> [--project-ref <ref>]`
  (working names; must be added to `GLOBAL_OPTS`/HELP in `src/cli/index.ts`, a work item).
- `ROLECALL_PROJECT_GIT_URL` is honored as the env equivalent (it already parses; this
  ADR gives it its first consumer). `ROLECALL_PROJECT_GIT_REF` is added for the ref.
- **Precedence:** explicit CLI flag > env var > local-disk behavior. There is no
  auto-detection: a URL is cloned only when the user selected a remote source. A remote
  source is never inferred from playbook/inventory content (see §7).

### 4. Path resolution under a remote project

When a remote source is selected, the project root is the **checkout root**, and:

- the positional `<file>` and `--inventory <file>` are resolved **relative to that
  root** (and must stay within it);
- `imports`/`include_tasks`/roles/`module: ./path` resolve against the same root;
- the `plugins/` vs `collections/` root detection (ADR 0014) runs against the checkout,
  not the caller's cwd.

Without a remote source, all of this is unchanged: paths resolve against cwd exactly as
today. Absolute local paths keep meaning "local file," never "fetch this."

### 5. One factory, threaded through every read site

Introduce a single `prepareProjectSource(...)`/`createProjectSource(...)` factory in the
VFS layer that returns the selected backend (`FsProjectSource` or `GitProjectSource`) and
owns materialization. Replace the ad-hoc `new FsProjectSource(...)` construction at every
read site:

- `src/cli/commands/playbook.ts` — including passing the source to `loadPlaybookFile`
  (today it omits it) and using it for `scanAndRegister` root detection;
- `src/cli/commands/{inventory,facts,vars}.ts`, `src/config/loader.ts` defaults,
  `src/executor/module.ts`, `src/orchestrator/{engine,routes}.ts`.

Any call site that still constructs `FsProjectSource` directly would silently ignore a
remote selection; the factory is what prevents that drift.

### 6. Serve mode: additive project source metadata

`Project` gains optional source metadata (`source: { kind: "git", url, ref }`, or
equivalently `gitUrl`/`gitRef` columns). The persisted `path` remains the materialized
checkout, so existing rows and consumers are unchanged (additive migration). Project
create/update may materialize the checkout, and run dispatch resolves the source before
forking the child `playbook run` (ADR 0017/0020 keep the child non-special). Network
work happens on the server side, not in the child, so a scheduled/webhook run behaves
like a CLI run with a warm cache.

### 7. Trust boundary: a remote project is remote code

Cloning a repo and importing its `.ts` plugins executes arbitrary code on the control
node (ADR 0014 §8). Therefore:

- selecting a remote source is an explicit act (`--project` / env), never triggered by a
  playbook or inventory field;
- the docs must state that untrusted projects should arrive pre-bundled
  (`_bundled.js`, ADR 0014 §4.1/§8), and that JIT `bun install` over an untrusted repo is
  outside the trust boundary;
- the resolved commit is pinned, but operators should also be able to require **signed tags
  or commits**, use `--frozen`/lockfile semantics for collections and plugins, and mark a
  project **trusted** before `.ts` plugins are auto-imported. Cloning alone must not imply
  trust;
- the cache directory is treated as sensitive as the checkout itself (it contains
  executable project code) and is never shared across users.

### 8. Collections stay a separate concern

This ADR covers the **root project source only**. Dependency hydration (`collections.yml`
→ `collections/`, ADR 0015) remains its own feature with its own command. The two
compose — a git-sourced project may declare `collections.yml`, which is then resolved in
the checkout — but neither implements the other. `rolecall install` continues to mean
"central runtime," not "fetch my project."

## Alternatives considered

- **A virtual, read-only `ProjectSource` over git objects.** Rejected: `import()` and
  ADR 0014 bundling need real files and a writable target, so the virtual path would
  materialize anyway; and every extra indirection diverges from the disk behavior the
  rest of the codebase was written against.
- **Document clone + `cd` and stop.** Rejected as the *only* answer because it leaves
  relative imports cwd-dependent, gives serve mode no repo concept, and keeps
  `ROLECALL_PROJECT_GIT_URL` a dead env var. It remains the zero-config fallback and must
  keep working.
- **Use `isomorphic-git`.** Rejected for now: a new runtime dependency, incomplete
  SSH/credential-helper parity, and another dual-runtime surface (ADR 0018), to avoid a
  `git` binary that deploy environments already have. The git CLI is used through the
  PAL spawn seam; a missing `git` is a clear typed error, not a silent fallback.
- **Fresh temp clone per run.** Rejected: cold, uncached, and wasteful for repeated or
  scheduled runs; a content-addressed cache gives the same isolation with warm starts.
- **Fold this into ADR 0015 / `rolecall collections install`.** Rejected: ADR 0015
  explicitly separates runtime bootstrap from project hydration, and a dependency
  fetcher is not a project source.

## Consequences

**Positive**
- `rolecall playbook run --project git+https://…` works from any directory; relative
  `imports`, roles, plugins, and `module: ./path` resolve against the repo root.
- `ROLECALL_PROJECT_GIT_URL` stops being dead config and gains a clear meaning.
- All three surfaces that already read through `ProjectSource` (loader, inventory
  plugin, executor) work unchanged once the factory is threaded through.
- Serve, cron, and webhooks can run git-backed projects with the same executor
  semantics as the CLI.
- Cache + offline mode make CI/serverless runs deterministic and network-free when
  desired.
- No new runtime dependency; auth reuses the platform git tooling.

**Negative / risk**
- Clone/fetch is a network operation with the usual failure modes (auth, DNS,
  host keys, partial clones); every failure must be a typed, redacted error.
- A local cache of executable project code is a new artifact to secure and clean up.
- The factory-tread-through touches many call sites; a missed one silently falls back to
  cwd, so tests must assert the source is honored end-to-end.
- Materialization still needs a writable destination, so truly read-only deployments must
  pre-populate the cache (or use `--offline` against a baked checkout).
- Serve-mode schema changes add migration surface; keeping them additive is an
  obligation, not a given.
- The trust boundary is sharpened: "run my repo" is "execute my repo's plugins."

## Work items
- [ ] Add `src/vfs/git-project-source.ts`: cache key/layout, shallow clone, fetch+checkout, atomic rename + lock, offline/refresh, redacted errors, delegate to `FsProjectSource`
- [ ] Add `prepareProjectSource`/`createProjectSource` and replace direct `FsProjectSource` construction at the read sites in §5 (fix `playbook run` passing no source to `loadPlaybookFile`)
- [ ] Add `--project` / `--project-ref` to `GLOBAL_OPTS`/HELP; give `ROLECALL_PROJECT_GIT_URL` its first consumer and add `ROLECALL_PROJECT_GIT_REF`
- [ ] Add `source` metadata to the `Project` store model + migration, and materialize on create/dispatch in the orchestrator
- [ ] Add signed-commit/tag verification (optional policy), `--frozen`/lockfile semantics for project dependencies, and an explicit trusted-project flag gating `.ts` plugin auto-import
- [ ] Contract-test `GitProjectSource` against the `FsProjectSource` suite (`src/vfs/project-source.test.ts`), skipping when `git` is unavailable; cover offline, moving refs, concurrent materialization, and cache corruption
- [ ] Dual-runtime tests per ADR 0018 (`ROLECALL_RUNTIME=bun` and `=node`)
- [ ] Four-surface sync per AGENTS.md once implemented: `AGENTS.md` (status/flag), `README.md`, `design/` (this ADR + the `design/README.md` map, `vfs-and-io-abstractions.md` matrix, `goals.md`, `serverless-and-git-friendly.md` Phase 1), `docs/` guide

## References
- `src/vfs/project-source.ts` (the seam), `src/vfs/fs-project-source.ts` (the backend to delegate to)
- `src/config/env.ts:37-38,88` (`projectGitUrl` parsed but unused), `src/config/loader.ts:852` (`loadPlaybookFile` default source)
- `src/cli/commands/playbook.ts:48,56-63` (no source passed to the loader; project-root heuristic), `src/cli/commands/{inventory,facts,vars}.ts`
- `src/executor/module.ts:173` (module source default), `src/orchestrator/{engine,routes}.ts` (`FsProjectSource(dirname(inventory))`)
- `src/store/types.ts:15-22` (`Project.path`, no repo/ref), `src/store/projects.ts`
- `src/modules/builtins/git.ts` (target-side clone module — not a project source)
- `design/vfs-and-io-abstractions.md` (backend matrix, env selection), `design/serverless-and-git-friendly.md` (Phase 1 scope), `design/goals.md` (ProjectSource target capability)
- ADR 0004, ADR 0005, ADR 0014 (§4, §8), ADR 0015, ADR 0017, ADR 0018, ADR 0020
