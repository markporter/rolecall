# 0004 — Serverless & git-friendly target capabilities

- Status: **Proposed**
- Date: 2026-09-18

## Context
RoleCall currently hard-wires two things: project files (playbooks, inventory, user
modules) are read from the local filesystem, and durable state (runs / traces /
schedules) lives in a single SQLite file. That coupling blocks the
git-backed / serverless / stateless direction we want — running RoleCall from CI,
AWS Lambda, Cloud Run, or as a sidecar next to the workload it manages, where
there may be no persistent local disk and multiple instances need shared state.

The executor and module systems are still being built. If we let scattered
file/SQLite reads multiply now, retrofitting these deployment shapes later
becomes expensive. We need a decision on the *target capabilities* and on a
*seam-first* approach that does not require rewriting the engine later.

## Decision
Adopt the following as **explicit target capabilities** for RoleCall (planned, not yet
implemented):

- **Git-backed / object-store project source** — playbooks, inventory, and user
  modules resolvable from a git repo or object storage instead of local disk.
- **Dialect-agnostic state backend** — SQLite today, Postgres (e.g. RDS) later,
  behind one `DbConn` interface so multi-instance / serverless deployments can
  share state.
- **Pluggable scratch VFS** — temporary artifacts in local disk, memory, or
  object storage, selected by environment variable.
- **One-shot serverless mode** — boot → handle one request/run → exit, distinct
  from the long-lived `--serve` orchestrator.
- **12-factor configuration** — all of the above selected through one
  `loadConfig()` reading `ROLECALL_DB_BACKEND`, `ROLECALL_DB_URL`, `ROLECALL_PROJECT_GIT_URL`,
  `ROLECALL_SCRATCH`, `ROLECALL_SCRATCH_DIR` (Bun auto-loads `.env`).

Implement them **seam-first**: define the `ProjectSource`, `DbConn` +
`drizzle-orm` repositories, and `ScratchVfs` interfaces with the simple local
default implementations now; leave the git / Postgres / S3 variants as
env-selected drop-ins. Default behavior (project on local disk, SQLite state,
temp files on disk) must remain unchanged when no env vars are set.

## Consequences
- Local, single-instance RoleCall is unchanged until an operator opts in via env vars.
- Git / Postgres / S3 backends become same-shape additions, not rewrites — the
  engine stays backend-agnostic.
- Multi-instance deployments require the Postgres backend (SQLite cannot be
  shared); Postgres coordinates concurrency via row locks / MVCC (per ADR 0006), dropping the single-writer queue.
- Serverless one-shot mode is deliberately separate from `--serve`; Lambda-style
  targets run one-shot CLI invocations, not the long-lived server.
- Introduces the seams tracked in `.omo/plans/vfs-db-abstractions.md`; the
  higher-level capabilities and phased plan live in
  `../serverless-and-git-friendly.md`.
- The deferred target backends (git / Postgres / S3, one-shot serverless) are not built yet; the local-disk `ProjectSource` and SQLite `DbConn` defaults are implemented per ADR 0005/0006. The executor remains the gating wave (per the honesty principle, scaffold ≠ functional).

> *Reconstructed from `.omo/plans/vfs-db-abstractions.md` after an uncommitted
> working-tree reset removed the original; cross-check intent before relying on
> it.*
