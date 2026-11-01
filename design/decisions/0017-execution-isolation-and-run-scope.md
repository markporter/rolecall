# 0017 — Execution isolation: dependency-injected run scope and forked playbook runs

- Status: **Accepted — implemented (fork-per-run + run-scope seams)**
- Date: 2026-10-14
- Related: [ADR 0014](0014-project-and-plugin-architecture.md) (plugin resolution), [ADR 0016](0016-plugin-and-module-sdk-authoring-surface.md) (module/plugin SDK), [ADR 0006](0006-storage-backend-colocation-and-postgres.md) (storage)

## Context

ADR 0014 introduced `src/modules/resolver.ts` with module-level globals:
`resolutionByType`, `bareAliasByType`, and `ambiguousBareByType`. The
`buildResolutionTable(entries, builtinNames)` function clears and rebuilds all
three; `scanAndRegister(root)` (L195) builds the table, eagerly loads module
objects, and calls `registerFactPlugin` (L207). Then `resolveModule(spec)` (L83)
reads those globals synchronously. It is called at dispatch time from
`src/executor/runner.ts:228` and `src/executor/tx.ts:158`. Nothing about that
hand-off is owned by a run; the table simply lives in the module scope.

A second, identical race sits one hop away. `scanAndRegister` calls the global
`registerFactPlugin`, which appends to `registeredFactPlugins` and mutates the
shared `defaultFactsEngine` (`src/facts/engine.ts:44-55`). Two concurrent runs
scanning different project roots would cross-contaminate their facts, exactly as
they would cross-contaminate their resolution tables. The same pattern shows up
in two more places: the executor's module `registry` Map in
`src/executor/module.ts` (builtins plus `plugin register` entries) and the
`searchModules` metadata map (`src/modules/search.ts`).

Today the CLI is one-shot, so none of this races: one process, one scan, one
run, exit. `rolecall --serve` (`src/orchestrator/**`) is different: it is a
long-lived process. **Implemented:** the serve engine no longer calls
`runPlaybook` in-process. Each job is forked to `rolecall playbook run -o jsonl`
with a materialized temporary playbook/inventory pair (`src/orchestrator/
child-run.ts`), so resolver/facts/module/search globals are process-local to each
run. The scheduler and webhooks fire through the same `Engine.enqueue` path, and
the child's typed event/result stream carries progress back to the parent.

One subsystem is already safe for multi-process use. The Store sets
`journal_mode=WAL`, `synchronous=NORMAL`, and `busy_timeout=5000`
(`src/store/schema.ts:14-16`); `openStore()` is a factory, not a singleton, and
`WriteQueue` serializes writes per process. A forked child can open its own
Store against the same database without corruption. That property is what makes
the fork-based option in §2 viable at all.

## Decision

### 1. Dependency-injected run scope (for every in-process runner)

Replace the process-global resolution and fact state with a per-run value
object, a `ResolutionTable` (or `RunScope`), that `scanAndRegister(root)`
returns and that is threaded explicitly through the run:

- `ExecOptions` (`src/executor/context.ts`) gains a `resolution` field.
- `RunState` (`src/executor/runner.ts`) carries it forward.
- `resolveModule(spec)` becomes `resolveModule(spec, table)`.
- `RollbackInput` in `src/executor/tx.ts` gains an optional `resolution`, used
  by the default `resolveForTx` so rollbacks resolve against the same table as
  the forward path.
- Scanned fact plugins travel on the table (e.g. `table.factPlugins`) instead of
  being registered globally via `registerFactPlugin`.

The rationale is eliminating "global scope poisoning": no ambient state shared
across runs, explicit ownership of the table by the caller, type-enforced
plumbing, and identical behavior on Bun and Node. This applies to any in-process
multi-run caller, tests and MCP handlers included, not only serve.

Two process-level objects are intentionally shared and must be documented as
such rather than scoped away. The builtin-plus-`plugin register` module registry
(`src/executor/module.ts`) is effectively read-only user configuration that
should be identical across runs in a process. The injected `Store` is shared by
design, and its single-writer `WriteQueue` plus WAL already handle concurrency.
Scoping is for resolution and facts; the registry and the Store are not on that
list.

### 2. Fork-per-run for `rolecall --serve`

The serve orchestrator runs each playbook execution as a forked child process
invoking the one-shot CLI (`rolecall playbook run … -o json`). The child is the
existing CLI entrypoint; the parent is the orchestrator, which parses a
newline-delimited JSON (ndjson) event stream from the child's stdout for
progress and results.

This contains every process global at once: resolver tables, facts engine,
module registry, and search metadata all reset in a fresh process, with no need
to enumerate them one by one. It also buys crash and hang isolation (a bad
plugin cannot take down the server) and trivial cancellation (send SIGTERM to
the child). It reuses the exact CLI path users already exercise, and it is
feasible precisely because SQLite is WAL plus `busy_timeout`, so parent and
child can both hold the Store open.

The protocol is ndjson events on the child's stdout, produced by extending the
`-o json` output plugin and the run-trace, with defined exit codes and SIGTERM
as the cancel signal.

The cost is real: per-run process startup and re-loading the roughly 70 builtins
(mitigable later with a warm-process pool), a new IPC/protocol surface to build
and version, and the fact that streaming and observability now flow through the
protocol rather than in-process callbacks.

## Consequences

**Positive**
- No cross-run leakage of resolution tables or fact state, in serve or in any
  in-process multi-run caller.
- Crash and hang containment for serve: a failing or hanging plugin dies with
  its child process, not the orchestrator.
- Cancellation becomes a SIGTERM to the child, with no cooperative-cancellation
  protocol to invent inside the executor.
- Ownership of run state is explicit and type-enforced instead of ambient,
  which reads the same under Bun and Node.

**Negative / risks**
- Per-run process startup overhead, including re-loading builtins, until a warm
  pool exists.
- The ndjson protocol is a new surface that must be built, versioned, and kept
  in sync with the CLI output shape.
- Future code must not accidentally re-introduce module-level globals for
  per-run state; the DI shape has to be the path of least resistance.
- `worker_threads` were considered and rejected: Bun's `worker_threads` support
  is partial (per AGENTS.md), and workers would still fork the shared Store and
  transport sessions for no correctness gain over dependency injection.

**Work items**
1. Fork-per-run is implemented in `src/orchestrator/child-run.ts`: temp
   playbook/inventory materialization, `-o jsonl` event/result protocol, child
   resolution, timeout/SIGTERM, and parent-side trace persistence.
2. Server HTTP runs use the CLI's real `http` module; network-simulator targets use
   `SimNetworkConnection` against the simulator's `POST /cli` bridge.
3. `--check`/`--diff`/`--force` and handlers/tx/roles/phases now apply to server runs.
4. Four-surface doc sync is part of the same change.
5. **Remaining:** dependency-injected `RunScope` for in-process multi-run callers
   (tests/MCP) remains a follow-up; serve no longer needs it because the fork
   isolates globals.

## References
- RoleCall source: `src/modules/resolver.ts` (globals, `buildResolutionTable`, `scanAndRegister`, `resolveModule`), `src/facts/engine.ts` (`registerFactPlugin`, `defaultFactsEngine`)
- `src/executor/context.ts` (`ExecOptions`), `src/executor/runner.ts` (dispatch call site), `src/executor/tx.ts` (`RollbackInput`, `resolveForTx`), `src/executor/module.ts` (shared registry), `src/modules/search.ts` (`searchModules`)
- `src/orchestrator/**` (serve mode, `Engine.#executeOne`), `src/store/schema.ts` (WAL, `busy_timeout`)
- ADR 0014 (project & plugin architecture), ADR 0016 (plugin/module SDK authoring surface), ADR 0006 (storage backend colocation & Postgres)
