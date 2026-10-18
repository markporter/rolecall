# 0017 — Execution isolation: dependency-injected run scope and forked playbook runs

- Status: **Proposed**
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
run, exit. `rolecall --serve` (`src/orchestrator/**`) is different. It is a
long-lived process, and when it starts running playbooks, concurrent runs inside
one process would race and leak one project's resolution into another. The
orchestrator's `Engine` (`src/orchestrator/engine.ts`) today uses its own
simplified `#executeOne` path and does not call `runPlaybook`, and the
scheduler/cron/webhooks are still scaffolded, so the race is latent. That is
good news: the fix can land before serve ever wires up playbook execution.

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

**Work items (implementation, not in this ADR)**
1. Add the per-run table type and make `scanAndRegister` return it.
2. Add the optional table parameter to `resolveModule` and thread `resolution`
   through `ExecOptions`, `RunState`, and `RollbackInput`.
3. Update `tests/resolver.test.ts` to pass the table, and add a
   two-roots-isolated test proving two scans do not bleed into each other.
4. Remove the resolver module globals (`resolutionByType`, `bareAliasByType`,
   `ambiguousBareByType`).
5. Route scanned fact plugins through the table instead of the global
   `registerFactPlugin`.
6. Define the child-run JSON event protocol, exit codes, and SIGTERM handling.
7. Wire the serve orchestrator to fork `rolecall playbook run` and parse the event
   stream.
8. Four-surface doc sync (`AGENTS.md`, `README.md`, `design/`, `docs/`).

## References
- RoleCall source: `src/modules/resolver.ts` (globals, `buildResolutionTable`, `scanAndRegister`, `resolveModule`), `src/facts/engine.ts` (`registerFactPlugin`, `defaultFactsEngine`)
- `src/executor/context.ts` (`ExecOptions`), `src/executor/runner.ts` (dispatch call site), `src/executor/tx.ts` (`RollbackInput`, `resolveForTx`), `src/executor/module.ts` (shared registry), `src/modules/search.ts` (`searchModules`)
- `src/orchestrator/**` (serve mode, `Engine.#executeOne`), `src/store/schema.ts` (WAL, `busy_timeout`)
- ADR 0014 (project & plugin architecture), ADR 0016 (plugin/module SDK authoring surface), ADR 0006 (storage backend colocation & Postgres)
