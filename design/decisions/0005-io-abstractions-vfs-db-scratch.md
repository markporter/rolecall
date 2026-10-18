# 0005: IO Abstractions (VFS reaches modules, DbConn plus drizzle-orm, pluggable S3)

- Status: **Proposed**
- Date: 2026-09-18
- Supersedes: none
- Related: [ADR 0004](0004-serverless-and-git-friendly.md) (why git/Postgres/object-store backends matter), [`vfs-and-io-abstractions.md`](../vfs-and-io-abstractions.md) (the seam backend matrix)

## Context

RoleCall's MVP reads project bytes straight from local disk and keeps all state in one
SQLite file. That works on a laptop or a long-lived orchestrator, but it blocks the
environments practitioners actually want: CI runners, AWS Lambda, Cloud Run, and
co-located sidecars, all with no persistent local disk and (for fleets) a need for
shared durable state. Three independent seams let RoleCall swap where those bytes live:

1. **Project source**: where playbooks, inventory, and user modules come from.
2. **Database connection**: where runs, traces, and schedules persist.
3. **Scratch storage**: where temporary artifacts land during a run.

We want to build these seams before the executor and module systems read files and
SQLite everywhere, because retrofitting later scatters concrete dependencies across the
codebase. Each seam below stays narrow so a deferred backend can drop in behind it
without touching call sites. None of this applies remote state yet; the executor remains
the gating wave. Defaults stay identical to today until an env var selects otherwise.

## Decision

Adopt three interfaces in `src/`, each implemented once in a local/default form and left
open to deferred backends of the same shape.

### 1. ProjectSource: the VFS seam reads user modules, not just playbooks/inventory

Define `ProjectSource` (`src/vfs/project-source.ts`) as the single surface through which
RoleCall fetches project / infra-as-code bytes: `readText`, `exists`, `listFiles(glob?)`,
`resolveImportablePath`, and a `root`. The critical member is
`resolveImportablePath(relPath)`: it returns an absolute filesystem path so `import()`
loads a user-authored module unchanged, regardless of where those bytes came from.

Consequence: `module: ./path` loading goes through the same VFS as playbook and inventory
reads. Today `FsProjectSource` (`src/vfs/fs-project-source.ts`) implements it against
local disk using Node `node:fs`/`node:path` builtins, so it behaves identically under Bun
and Node. It was wired into every existing caller (`loader.ts`, `inventory/plugin.ts`,
`executor/module.ts`) with default behavior byte-for-byte unchanged. Git and object-store
variants implement the same interface and will select via env var once built.

Backends:
- Implemented now: `FsProjectSource` (local disk).
- Deferred: `GitProjectSource` and `S3ProjectSource` (same interface, selected by
  `ROLECALL_PROJECT_GIT_URL`).

### 2. DbConn + drizzle-orm: dialect-agnostic store behind one schema

Rewrite the repositories against a dialect-agnostic `DbConn` contract
(`src/store/db.ts`): `query<T>` → rows, `run` → `{ changes, lastInsertId? }`, `exec` →
free-form DDL/pragmas, `close`. Repositories issue drizzle tagged-template statements
(`${param}` interpolation) executed through a `DbConn`; they never touch a runtime-specific
DB handle. Parameter binding therefore stays correct across dialects, and user input is
never concatenated into SQL strings.

The only new dependency is `drizzle-orm`. It sits between the repositories and either SQL
dialect so both share one schema. Table/column names are unchanged, so the data model is
untouched. Today `createSqliteDbConn(database)` wraps a native `bun:sqlite` handle via
`drizzle(database)` from `drizzle-orm/bun-sqlite`. A future `postgres-js` implementation
of the same `DbConn` shape swaps in behind `ROLECALL_DB_BACKEND`.

Backend selection lives in `loadConfig()` (`src/config/env.ts`) plus `openStore()`:
- Implemented now: SQLite (`SqliteDb`).
- Deferred: Postgres (`PostgresStore`, postgres-js).
- `ROLECALL_DB_BACKEND=postgres` parses cleanly then throws a clear *"not implemented
  (deferred)"* error at `openStore()`. No silent fallback to SQLite, so nothing ever runs
  against the wrong store. Non-Bun runtimes throw their own "deferred past MVP" message
  for the SQLite path.

### 3. ScratchVfs: object storage is a pluggable backend for two separate seams

Define `ScratchVfs` (`src/vfs/scratch.ts`) as a minimal async key/value scratch space:
`write`, `read`, `exists`, `delete`, `list`. `createScratchStore()` selects the impl from
`loadConfig().scratch`: `"memory"` returns `MemoryScratchStore`; anything else returns
`FsScratchStore` under `ROLECALL_SCRATCH_DIR` (or `os.tmpdir()`), so concurrent stores never
collide. Reading/deleting a missing name rejects ENOENT-style; `exists` returns false.

Object storage is available independently under BOTH seams that hold content:
- `ProjectSource` gets `S3ProjectSource`.
- `ScratchVfs` gets `S3ScratchStore`.

They are separate choices; a deployment could point project bytes at S3 while keeping
scratch on local disk, or vice versa. Both remain deferred. For scratch specifically, the
`ROLECALL_SCRATCH` value `s3` is reserved/designed-in but not yet wired: today the type and
factory support only `fs` and `memory`, so `ROLECALL_SCRATCH=s3` resolves to `fs` until
`S3ScratchStore` lands. Unlike Postgres it does not throw, since scratch content is
ephemeral.

## Consequences

- **Positive:** deferred backends drop behind narrow interfaces without rewriting call
  sites. `ProjectSource` reaches user modules through the same read surface as
  playbooks/inventory. The store shares one schema across SQLite and Postgres because
  `drizzle-orm` compiles parameterized placeholders dialect-correctly. Object storage is
  reusable for both project bytes and scratch. Defaults stay identical to today, so no
  environment changes unless an env var is set.
- **Honesty cost:** these docs must mark each deferred backend as planned, never claim it
  works. [`vfs-and-io-abstractions.md`](../vfs-and-io-abstractions.md) encodes this as
  a matrix marked Implemented now vs Planned. See also the honesty principle in
  [`goals.md`](../goals.md).
- **Constraint cost:** `drizzle-orm` is the sole new dependency. Do not introduce a second
  query builder (no kysely); keep `DbConn` builder-agnostic. Every public export added
  here carries TSDoc per the AGENTS.md rule.
- **Selection constraint:** all switching happens through `loadConfig()` env vars
  (`ROLECALL_PROJECT_GIT_URL`, `ROLECALL_DB_BACKEND`, `ROLECALL_DB_URL`, `ROLECALL_SCRATCH`,
  `ROLECALL_SCRATCH_DIR`), never CLI flags. This adds no user-facing surface.
- **Risk:** a naive base-dir join concatenates absolute paths instead of resolving them
  (`path.join` treats an absolute argument literally, `path.resolve` resets). Project
  source had exactly this bug during QA and was fixed by guarding absolute inputs. Keep
  `resolveImportablePath` resolve-based, not join-based.
