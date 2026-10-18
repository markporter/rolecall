# 0006: Storage Backend Model (local SQLite colocation + Postgres auto-fallback)

- Status: **Proposed**
- Date: 2026-09-19
- Supersedes: none
- Related: [ADR 0004](0004-serverless-and-git-friendly.md) (git-backed projects & serverless target capabilities), [ADR 0005](0005-io-abstractions-vfs-db-scratch.md) (the VFS/DbConn seams that make a second dialect possible), [`vfs-and-io-abstractions.md`](../vfs-and-io-abstractions.md) (the DbConn seam backend matrix)

## Context

RoleCall's MVP keeps all durable state in one local SQLite file opened by every `openStore()`
call. Today the three production callers (`src/orchestrator/serve.ts`,
`src/cli/commands/run.ts`, `src/cli/commands/playbook.ts`) each invoke `openStore()` with
no options, so `store.ts`'s `resolveRegistryPath` per-project branch is effectively dead
code and every registry lands wherever the global/home default resolves. That is fine on a
laptop or a long-lived orchestrator, but it blocks fleets that need shared durable state and
environments (CI runners, Lambda, Cloud Run, co-located sidecars) described in
[ADR 0004](0004-serverless-and-git-friendly.md).

The T3 DbConn seam shipped with [ADR 0005](0005-io-abstractions-vfs-db-scratch.md) already
made the repositories dialect-agnostic: they issue drizzle tagged-template statements run
through a dialect-agnostic `DbConn` and never touch a runtime-specific DB handle. This ADR
is the next step after that seam. It records *which* backends actually get built, how one is
selected versus the other, where the local file lives, what happens on failure, and exactly
what "build later" means. The only store dependency is `drizzle-orm`; wiring Postgres just
adds `drizzle-orm/postgres-js` behind the same interface. None of this ships yet: currently
`ROLECALL_DB_BACKEND=postgres` throws `"not implemented (deferred)"` inside `openStore()`, and the
SQLite path is guarded to Bun-only until Node parity lands.

This decision belongs alongside the seam design (ADR 0005) and the git/serverless goals
(ADR 0004); together they define RoleCall's storage model end to end.

## Decision

### Detection: which backend? Auto vs strict

Three cases, evaluated in order:

1. `ROLECALL_DB_URL` set → attempt Postgres (auto mode). If the PG connection fails, fall back to
   local SQLite and emit a warning rather than crashing.
2. `ROLECALL_DB_BACKEND=postgres` explicitly set → strict mode. Any PG connect error fails loud
   (throws); NO silent fallback to SQLite, so nothing ever runs against the wrong store.
3. Neither set → local SQLite.

In short: `ROLECALL_DB_URL` unset means local SQLite. Setting `ROLECALL_DB_BACKEND=postgres`
explicitly converts detection to strict so a failed remote connect refuses silently dropping
into the local database. Explicit selection always wins over URL-based auto-detection.

### Local DB path: per-project colocation by default

State file name is `state.db`. Path resolution (first match wins):

1. Explicit `opts.dbPath` (programmatic/test callers).
2. `<projectDir>/.rolecall/state.db`: the per-project branch becomes the **default**, turning
   `resolveRegistryPath`'s per-project case from dead code into the normal path. Each
   workspace gets its own colocated registry on a laptop or node.
3. `$ROLECALL_PROJECT_STATE` override: an explicit home/root hook.
4. `<cwd>/.rolecall/state.db`, used when no project directory can be determined (replaces the
   older homedir `~/.rolecall` default).

### Bootstrap: always fresh, never migrate

Both backends bootstrap identically: start empty and apply idempotent table creation
(`CREATE TABLE IF NOT EXISTS`, i.e. `SCHEMA_DDL`) on open. There is **no migration** and
**no import** of existing local data. Switching backends therefore starts clean; the two
stores diverge by design. See Consequences for why that divergence is acceptable.

### Schema: one shared DDL across both backends

The four tables are unchanged (from `src/store/schema.ts` `SCHEMA_DDL`):

- `projects(id, path, inventoryRef, playbookRef, vars JSON, history JSON, createdAt, updatedAt)`
- `runs(id, projectId, actionType, targetIds JSON, status, resultSummary, startedAt, finishedAt, payload JSON)`
- `schedules(id, name, cronSpec, actionType, params JSON, enabled INTEGER, nextRunAt, lastRunAt)`
- `run_traces(id, run_id, host, task_name, iteration, phase, status, started_at, ended_at, duration_ms, tx_id, checkpoint_id, detail JSON, seq)`; this column set supports Todo 25 trace replay and Todo 26 transaction/checkpoint tracking.

Multi-tenancy: Postgres serves many projects through the existing `runs.projectId` column;
no schema change is required. On the SQLite side today, durability pragmas are WAL +
`synchronous=NORMAL` + `busy_timeout`, and all mutations serialize through ONE `WriteQueue`.

### Build needs (when wired)

All deferred; none exist yet:

- Implement `PostgresStore` behind the existing `DbConn` interface using `drizzle postgrejs`,
  i.e. add `drizzle-orm/postgres-js`. The repositories stay untouched because they are already
  backend-neutral from the vfs-db-abstractions work (ADR 0005); they talk to whatever `DbConn`
  the store hands them.
- Auto-detect selection inside `openStore()` following the three-case rules above, reading env
  via `loadConfig()` (`src/config/env.ts`).
- Relax the Node runtime guard so Postgres runs under Node; keeping the SQLite-under-Node path
  deferred past MVP.
- Drop the single-writer `WriteQueue` for Postgres, letting row locks / MVCC handle concurrency.

Selection stays entirely behind env vars (`ROLECALL_DB_URL`, `ROLECALL_DB_BACKEND`, plus the state-path
hooks), not CLI flags. This ADR introduces **no new CLI surface**.

## Consequences

- **Positive:** each environment gets a sensible default (per-project `.rolecall/state.db`) without
  config, while fleets opt into shared durable Postgres behind the same schema. The DbConn seam
  already exists, so wiring Postgres adds one dependency and one implementation instead of a
  rewrite. Strict-vs-auto detection makes the safe choice explicit: auto degrades gracefully to
  local state, explicit postgres guarantees you never accidentally write to the wrong store.
- **Divergence is accepted:** after a switch, local SQLite and Postgres are independent state
  stores with no reconciliation. Data left in the old store is simply ignored until it is
  re-created in the new one; this is intentional given the "always fresh" bootstrap rule and
  avoids building a fragile migration/import tool.
- **Honesty cost:** these docs mark every Postgres behavior as Proposed/deferred and never claim
  it works. [`vfs-and-io-abstractions.md`](../vfs-and-io-abstractions.md) encodes the same split
  as an Implemented-now vs Planned matrix. Follow the honesty principle in [`goals.md`](../goals.md).
- **Constraint cost:** keep `dbBackend` values narrow (only `"postgres"` selects Postgres, else
  `sqlite`); do not widen the enum ad hoc. Every public export added carries TSDoc per AGENTS.md.
  When implemented, relax only the Node guard for Postgres, not for SQLite-under-Node.
- **Risk:** a failed PG connect must still fail loud when `ROLECALL_DB_BACKEND=postgres` was set
  explicitly; mixing strict and auto carelessly reintroduces silent cross-store writes. Keep the
  discriminator on whether `ROLECALL_DB_BACKEND=postgres` was explicitly provided.
