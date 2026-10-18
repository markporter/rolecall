# 0019 — Store over the PAL SqliteDb seam; drop drizzle-orm

- Status: **Accepted**
- Date: 2026-10-18
- Related: [ADR 0005](0005-io-abstractions-vfs-db-scratch.md) (IO abstractions / DbConn seam), [ADR 0006](0006-storage-backend-colocation-and-postgres.md) (storage backends / Postgres), [ADR 0018](0018-dual-runtime-distribution-npm-node-binaries-bun.md) (dual-runtime distribution)

## Context

ADR 0018 shipped the npm/Node channel but left the durable SQLite store Bun-only:
the store was written against drizzle-orm's `bun-sqlite` dialect, which needs a real
`bun:sqlite` handle. Under Node, `openStore()` threw
`"SQLite backend is not available under the Node runtime (deferred past MVP)"`, and
with it `--serve`, `--trace`, `--profile`, and `run replay` were unavailable on the
npm channel. That split was the last user-facing Bun exclusivity, and ADR 0018
flagged it plainly as a limitation to remove once a Node-capable store path landed.

Meanwhile the Node PAL already implemented `node:sqlite` (`DatabaseSync`) for the
`sql` builtin and the idempotency cache, and the PAL's `SqliteDb` seam is
synchronous on both runtimes. drizzle-orm itself was never the point: it was a
Bun-locked convenience for parameter binding and schema typing, and it was the only
reason the store could not run under Node.

## Decision

### 1. Drop drizzle-orm; rewrite the store over the PAL `SqliteDb` seam

`drizzle-orm` is removed from the codebase and from `package.json` dependencies
entirely. The repositories in `src/store/` now issue plain parameterized SQL
(positional spread params, never string concatenation) through the PAL's
`SqliteDb` interface, with small shared helpers in `src/store/sql.ts`
(`selectAll` / `selectOne` / `execute` / `transactional`). The schema is plain
idempotent `CREATE TABLE IF NOT EXISTS` DDL applied at open time, plus the
durability pragmas (`journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`).

### 2. Runtime-selected SQLite on both runtimes

The backend handle is opened through `getPAL().sqlite.open(dbPath)`, which selects
`bun:sqlite` under Bun and `node:sqlite` under Node. Because both PAL
implementations expose a synchronous handle, `openStore()` needs no `await` and
works identically under either runtime. The bun-only runtime guard is gone, and
its error message no longer exists in code. `node:sqlite` still prints a one-time
`ExperimentalWarning` to stderr on first use under Node; that is accepted and stays
documented as expected. The known caveat: `node:sqlite` is newer and less battle-
tested than `bun:sqlite` (still marked experimental upstream), so the Node path is
watched by CI rather than assumed equivalent.

### 3. Read-modify-write fencing via `BEGIN IMMEDIATE`

All mutations serialize through the single `WriteQueue`, and every read-modify-write
sequence (check-then-set across two connections sharing one file) is wrapped in
`BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` via the `transactional()` helper. The
transaction body must be synchronous — an `await` inside would let unrelated work
interleave and defeat the fencing (the dbt #14550 lesson). This replaces whatever
transaction guarantees drizzle's dialect layer provided.

### 4. Why: the enterprise seam is the interface, not the ORM

The durable store must be enterprise-replaceable: the narrow `Store` /
`TracesRepository` interface in `src/store/types.ts` is the future Postgres seam
(ADR 0006). What matters for that swap is that repositories talk to one narrow,
typed interface — not which SQL library compiles the statements. drizzle was
chosen in ADR 0005 as a dialect-agnostic convenience, but it locked the SQLite
path to Bun and added a dependency for work (parameter binding, DDL) the PAL
handle already does well. Both runtimes ship first-party sqlite drivers
(`bun:sqlite`, `node:sqlite`), so the PAL seam alone is enough. Postgres remains
record-only and throws (`ROLECALL_DB_BACKEND=postgres is not implemented
(deferred)`); when it lands it will be implemented behind the same `Store`
interface, not behind an ORM.

### 5. What this unlocks on Node

Nothing user-facing is Bun-only anymore. `--serve`, `--trace`, `--profile`, and
`run replay` all work under the npm/Node channel. Bun's remaining value is
compiled binaries, dev ergonomics (`bun run dev`, `bun bin/rolecall.js`), and
faster cold starts — not feature exclusivity. The bun-only runtime guards in the
store tests revert accordingly, so store tests now run under both forced runtime
branches.

## Consequences

**Positive**
- The npm/Node channel has the full feature surface; the registry package matches
  its own advertisement with no asterisk.
- One less runtime dependency; the store is plain SQL a future Postgres
  implementation can mirror statement-for-statement behind the `Store` interface.
- The dual-runtime test matrix now covers the store on both PAL branches, so
  `node:sqlite` regressions surface in CI instead of in the field.

**Negative / risk**
- `node:sqlite` is experimental upstream; its API can shift and it prints the
  one-time `ExperimentalWarning` on stderr. Accepted for now; the engines floor
  (Node >= 22.19) pins a known-good surface.
- Hand-rolled SQL loses drizzle's compile-time statement checking; the
  `transactional()` fencing rule (synchronous body only) is enforced by
  convention and review, not types.
- `lastInsertRowid` may be `bigint` under `node:sqlite` where `bun:sqlite`
  returns `number`; repository code must tolerate both.

## Work items
- [x] Rewrite `src/store/` repositories over the PAL `SqliteDb` seam; delete drizzle imports
- [x] Add `src/store/sql.ts` helpers incl. `transactional()` with `BEGIN IMMEDIATE` fencing
- [x] Remove the bun-only runtime guard from `openStore()` and its error message
- [x] Remove `drizzle-orm` from `package.json`
- [x] Revert bun-only early-returns in store tests so both runtime branches run them
- [x] Update all four surfaces (AGENTS.md, README.md, design/, docs/) to drop the Bun-only store claims

## References
- `src/store/store.ts` (openStore, pragmas, DDL), `src/store/sql.ts` (helpers + transactional), `src/store/index.ts` (public API)
- `src/pal/sqlite.bun.ts` / `src/pal/sqlite.node.ts` (runtime-selected handles)
- ADR 0005 (DbConn seam), ADR 0006 (Postgres deferral), ADR 0018 (Node channel + the now-superseded defer list)
