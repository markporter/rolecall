# Serverless & Git-Friendly Target Capabilities

> **Target capabilities + phased plan** for git-backed projects and serverless
> deploys. Companion to [ADR 0004](decisions/0004-serverless-and-git-friendly.md)
> (which records the decision) and the implementation plan
> [`.omo/plans/vfs-db-abstractions.md`](/.omo/plans/vfs-db-abstractions.md) (which
> builds the seams). This document describes where RoleCall is *going*, not what ships
> today.

**Status:** Proposed (ADR 0004). None of the capabilities below are implemented
yet — the executor is the gating wave, and the seams are designed-in but not
built. Per the honesty principle, scaffold ≠ functional.

## Why this direction
RoleCall's MVP reads everything from local disk and stores state in one SQLite file.
That is fine for a laptop or a long-lived orchestrator, but it blocks the
environments practitioners actually want: CI runners, AWS Lambda, Cloud Run, and
co-located sidecars — places with no persistent local disk and (for fleets) a
need for shared, durable state. Doing the *seams* before the executor and module
systems scatter file/SQLite reads everywhere is far cheaper than retrofitting
later.

## Target capabilities
1. **Git-backed project source** — playbooks, inventory, and user modules
   (`module: ./path`) resolvable from a git repo (or object store) instead of a
   local checkout. `resolveImportablePath` returns an absolute path for FS and a
   temp-extracted path for git/S3.
2. **Postgres state backend** — runs / traces / schedules in Postgres (e.g. RDS)
   alongside SQLite, behind the dialect-agnostic `DbConn` seam (ADR 0019). Required
   for multi-instance deployments (SQLite cannot be shared; Postgres uses advisory
   locks).
3. **Pluggable scratch VFS** — temporary artifacts in local disk, memory, or
   object storage, selected by `ROLECALL_SCRATCH` (`fs` | `memory` | `s3`, deferred).
4. **One-shot serverless mode** — boot → handle one request/run → exit. Distinct
   from the long-lived `--serve` orchestrator; this is what fits AWS Lambda.
5. **12-factor configuration** — all selection via env vars through one
   `loadConfig()`: `ROLECALL_DB_BACKEND`, `ROLECALL_DB_URL`, `ROLECALL_PROJECT_GIT_URL`,
   `ROLECALL_SCRATCH`, `ROLECALL_SCRATCH_DIR` (Bun auto-loads `.env`).

## Deployment shapes enabled
- **AWS Lambda** — one-shot run, project from git, state in RDS Postgres; pairs
  with Step Functions + the transaction/resume model (`tx_id` / `checkpoint_id`,
  todo 26) for runs past the 15-minute limit. `--serve` does **not** fit Lambda.
  SSH works, but HTTP/poll transport is recommended for ephemeral compute.
- **Docker / Kubernetes** — `--serve` is a natural K8s Deployment; no 15-minute
  timeout; SSH fine; multi-replica requires the Postgres backend. Packaging is the
  single-file binary (ADR 0002) + Dockerfile.
- **Sidecar** — co-located agent in the app pod; localhost REST/MCP control plane
  (todo 28, clientless); shared volume for managed files (atomic commit, todo 13,
  protects the app's open files); state optional (Postgres for durability or
  stateless idempotent re-converge on restart).

## Phased plan
- **Phase 0 — seams (designed, in `vfs-db-abstractions.md`)**: `ProjectSource`
   interface + `FsProjectSource`; `DbConn` repositories + `SqliteDb` (now over the
   PAL seam, ADR 0019);
   `ScratchVfs` + `FsScratchStore` + `MemoryScratchStore`; one `loadConfig()` env
   layer. Default behavior unchanged. `ROLECALL_DB_BACKEND=postgres` throws a clear
   "not implemented (deferred)" error (no silent sqlite fallback).
- **Phase 1 — remote project + scratch (deferred)**: `GitProjectSource` +
   `S3ProjectSource`; `S3ScratchStore`.
- **Phase 2 — Postgres backend (deferred)**: `PostgresStore` (postgres-js) +
   advisory locks for multi-replica coordination.
- **Phase 3 — serverless mode (deferred)**: one-shot run mode + HTTP/poll
  transport for ephemeral compute; Step Functions / tx-resume integration.

## Relationship to other docs
- [ADR 0004](decisions/0004-serverless-and-git-friendly.md) — the decision record.
- [`.omo/plans/vfs-db-abstractions.md`](/.omo/plans/vfs-db-abstractions.md) — the
  seam implementation plan (Todo 5 there also folds a `ProjectSource VFS` /
  `Scratch/temp VFS` target-capability bullet into `goals.md`).
- [architecture/connectivity.md](architecture/connectivity.md) — transport layer
  (SSH works for serverless; HTTP/poll recommended for ephemeral).
- [usecases.md](usecases.md) — use case 6 ("Serverless, git-friendly, stateless")
  is the marketing-facing version of this plan.

> *Reconstructed from `.omo/plans/vfs-db-abstractions.md` after an uncommitted
> working-tree reset removed the original; cross-check intent before relying on
> it.*
