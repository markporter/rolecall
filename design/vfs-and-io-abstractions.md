# VFS & IO Abstractions

> **Companion to** [ADR 0004](decisions/0004-serverless-and-git-friendly.md)
> and [`serverless-and-git-friendly.md`](serverless-and-git-friendly.md), which record
> *where* RoleCall is going (git-backed projects, Postgres state, object-store scratch).
> This document records *what the seams look like today*, which backends are wired, and
> which are deferred. It also feeds the `ProjectSource VFS` / `Scratch/temp VFS` target
> capabilities folded into [`goals.md`](goals.md).

## Why these seams

RoleCall's MVP reads everything from local disk and keeps its state in one SQLite file.
That suits a laptop or a long-lived orchestrator, but it blocks CI runners, AWS Lambda,
Cloud Run, and co-located sidecars, all places with no persistent local disk and (for
fleets) a need for shared durable state. Building the three seams before the executor and
module systems scatter file/SQLite reads everywhere is far cheaper than retrofitting
later. Each seam is a narrow interface so a deferred backend can be dropped in behind it
without touching call sites.

Nothing here applies remote state itself. These are read/resolve and key/value surfaces;
the executor now consumes their resolved inputs during live application, though these seams
themselves stay storage-only.

## Backend matrix

Rows are the three seams; columns are candidate backends. A cell marked **Implemented
now** ships in `src/`; **Planned (deferred)** is designed-in but not built; a blank cell
(`-`) means the backend does not apply to this seam.

| Seam (`src`) | Local disk (FS) | Git repo | Object store (S3) | SQLite | Postgres | Memory |
|---|---|---|---|---|---|---|
| **ProjectSource** (`src/vfs/project-source.ts`) | ✅ Implemented now (`FsProjectSource`) | ⏳ Planned (deferred, `GitProjectSource`) | ⏳ Planned (deferred, `S3ProjectSource`) | - | - | - |
| **DbConn** (`src/pal` SqliteDb seam) | - | - | - | ✅ Implemented now (`SqliteDb`, runtime-selected bun:sqlite/node:sqlite — ADR 0019) | ⏳ Planned (deferred, `PostgresStore`, postgres-js) | - |
| **ScratchVfs** (`src/vfs/scratch.ts`) | ✅ Implemented now (`FsScratchStore`) | - | ⏳ Planned (deferred, `S3ScratchStore`) | - | - | ✅ Implemented now (`MemoryScratchStore`) |

Legend: ✅ Implemented now · ⏳ Planned (deferred, designed-in) · `-` = backend N/A for this seam.

Two takeaways from the matrix:

- **S3 is a pluggable backend for two separate seams.** An object-store backend appears
  under both `ProjectSource` (`S3ProjectSource`) and `ScratchVfs` (`S3ScratchStore`). They
  are independent choices; a deployment could point project bytes at S3 while keeping
  scratch on local disk, or vice versa.
- **No query builder under DbConn.** The repositories issue plain parameterized SQL
  through the PAL `SqliteDb` seam (ADR 0019 dropped drizzle-orm); values are always
  bound positionally, never concatenated.

### What each seam looks like today

**ProjectSource** (`src/vfs/project-source.ts`) is the read surface through which RoleCall
fetches project / infra-as-code bytes: playbooks, inventory manifests, and user-authored
modules (`module: ./path`). Its members:

- `readText(relPath)` returns UTF-8 text and rejects if missing.
- `exists(relPath)` returns a boolean existence check.
- `listFiles(glob?)` returns sorted POSIX `/` paths, with optional glob filtering.
- `resolveImportablePath(relPath)` returns an absolute filesystem path so `import()` loads
  a module unchanged across backends. This is how the VFS reaches user modules, not just
  playbooks/inventory.
- `root` is the absolute root this source serves from.

Today only `FsProjectSource` (`src/vfs/fs-project-source.ts`) exists; it walks local disk
with Node `node:fs`/`node:path` builtins, so it behaves identically under Bun and Node. It
was wired into every existing caller (`loader.ts`, `inventory/plugin.ts`,
`executor/module.ts`), leaving their default behavior byte-for-byte identical. The git/S3
variants implement the same shape and will select via env var once built.

**DbConn** (the PAL `SqliteDb` seam, `src/pal/types.ts`) is the dialect-agnostic contract the repositories depend
on. Its members:

- `query<T>(stmt, params?)` returns rows keyed by column name.
- `run(stmt, params?)` returns `{ changes, lastInsertId? }`.
- `exec(sql)` runs free-form statements (PRAGMAs, DDL).
- `close()` releases the handle.

Repositories (`ProjectsRepository`, `RunsRepository`, `SchedulesRepository`,
`TracesRepository`) issue plain parameterized SQL through a `SqliteDb`, with no
runtime-specific DB handle anywhere. Values are bound positionally (spread params)
through the PAL, never concatenated, and read-modify-write sequences are fenced with
`BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` via `transactional()` in `src/store/sql.ts`
(ADR 0019). Today `getPAL().sqlite.open(dbPath)` selects the native handle —
`bun:sqlite` under Bun, `node:sqlite` under Node — so the store works on both
runtimes; a future `postgres-js` implementation of the same seam swaps in behind
`ROLECALL_DB_BACKEND`. Table/column names are unchanged, so the data model is untouched.

**ScratchVfs** (`src/vfs/scratch.ts`) is a minimal key/value space for temporary
artifacts. Its members:

- `write(name, data)`, `read(name)`, `exists(name)`, `delete(name)`, `list()`.

All methods are async for a uniform surface. `createScratchStore()` selects the impl from
`loadConfig().scratch`: `"memory"` returns `MemoryScratchStore`; anything else returns
`FsScratchStore`, which writes under a unique subdirectory of `ROLECALL_SCRATCH_DIR` (or
`os.tmpdir()`) so concurrent stores never collide. Reading/deleting a missing name
rejects with an ENOENT-style error; `exists` returns `false`.

## Environment selection

Selection is entirely env-driven through one `loadConfig()` layer
(`src/config/env.ts`); there is no CLI flag and no new public command. Every field has a
safe default, so unset variables leave behavior identical to prior versions.

| Env var | Selects | Default | Values |
|---|---|---|---|
| `ROLECALL_PROJECT_GIT_URL` | ProjectSource backend | *(unset = FS)* | any non-empty URL reserves the git-backed source (**reserved**, deferred) |
| `ROLECALL_DB_BACKEND` | DbConn dialect | `sqlite` | `sqlite` (wired) · `postgres` (throws "not implemented (deferred)", no silent sqlite fallback) |
| `ROLECALL_DB_URL` | Postgres connection string | *undefined* | used when `ROLECALL_DB_BACKEND=postgres` (deferred) |
| `ROLECALL_SCRATCH` | ScratchVfs strategy | `fs` | `fs` · `memory`; `s3` reserved/designed-in but **not yet wired** (deferred) |
| `ROLECALL_SCRATCH_DIR` | fs scratch directory | `os.tmpdir()` | empty/unset falls back there without throwing |

Notes on the table above:

- `ROLECALL_DB_BACKEND=postgres` parses cleanly as a `DbBackend` value, then `openStore()`
  throws a clear *"not implemented (deferred)"* error rather than silently falling back
  to SQLite. That hard fail is deliberate: it proves nothing ran against the wrong store.
- `ROLECALL_SCRATCH=s3` is listed as part of the design goal (see
  [`serverless-and-git-friendly.md`](serverless-and-git-friendly.md)), but today the
  `ScratchStrategy` type and `createScratchStore()` wire only `fs` and `memory`. Setting
  `s3` currently resolves to `fs` until the `S3ScratchStore` branch lands; unlike Postgres
  it does not throw, since scratch content is ephemeral. Once built it becomes a first-class
  option alongside `fs`/`memory`.
- No dotenv dependency here: Bun auto-loads `.env` into `process.env`, so reading
  `process.env` covers both real vars and any project `.env`.

## Defaults (unchanged)

Per the honesty principle, defaults still mean "local dev machine":

- **Project from local disk:** no `ROLECALL_PROJECT_GIT_URL` means `FsProjectSource`.
- **State in SQLite:** no `ROLECALL_DB_BACKEND` means `SqliteDb` over the runtime-selected PAL handle (`bun:sqlite` under Bun, `node:sqlite` under Node — ADR 0019).
- **Temp files on disk:** no `ROLECALL_SCRATCH` means `FsScratchStore` under the OS temp dir.

The deferred backends (git/S3 projects, Postgres state, S3 scratch) change none of this
until explicitly selected by an env var.

## Relationship to other docs

- [ADR 0004](decisions/0004-serverless-and-git-friendly.md): records the decision that
  these seams exist and why git/Postgres/object-store backends are planned.
- [ADR 0006](decisions/0006-storage-backend-colocation-and-postgres.md): the storage-model
  follow-on recording which dialects actually build from this DbConn seam, how `openStore()`
  detects and selects them (local colocation with auto-fallback vs strict), and why Postgres
  is deferred.
- [`serverless-and-git-friendly.md`](serverless-and-git-friendly.md): the phased plan
  (seams to remote project plus scratch, then Postgres, then serverless mode) whose Phase
  0 builds exactly these three interfaces.
- [`goals.md`](goals.md): folds `ProjectSource VFS` and `Scratch/temp VFS` into its
  target-capabilities list.
- [`.omo/plans/vfs-db-abstractions.md`](/.omo/plans/vfs-db-abstractions.md): the seam
   implementation plan where Todo 1 through 4 landed `src/config/env.ts` and `src/vfs/*`
   (the store side later moved to the PAL SqliteDb seam — ADR 0019).
