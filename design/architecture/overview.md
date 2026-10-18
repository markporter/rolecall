# Architecture Overview

## Components

| Component | Path | State |
|---|---|---|
| CLI entry / dispatch | `src/cli/*` | implemented |
| Orchestrator server (Express) | `src/orchestrator/*` | implemented (route registry, MCP, stores) |
| Stores (sqlite-backed repos) | `src/store/*` | implemented (runs/traces/schedules/projects) |
| Config model & validation | `src/config/*` | implemented (Zod) |
| Templating | `src/templating/*` | implemented (fast mode; Jinja verbatim) |
| Executor (tx / checkpoint) | `src/executor/*` | implemented (drives describe/converge live; rollback/resume via tx) |
| Modules / idempotency lib | `src/modules/*` | implemented (describe/converge executed live by executor) |
| Transport interfaces | `src/transport/*` | implemented (Ssh/Local/Network connect/run; Http gRPC deferred) |
| Docs search (embedded) | `src/docs/*` | implemented |
| Agent command | `src/cli/commands/agent.ts` | implemented |

## Boundaries
- **CLI** parses global flags and dispatches subcommands; the `--serve` branch boots the
   orchestrator. Playbook/facts commands build a per-host connection (`rolecall_connection`
   selects ssh|local|network) and drive tasks live over SSH/local transports, recording a run trace.
- **Orchestrator** owns the Express app, `ROUTE_DEFINITIONS`, `buildManifest()`/`validateToolInput()`,
  and the store layer. Graceful shutdown is handled by `installSignalHandlers` (SIGINT/SIGTERM →
  drain → store.close → exit); `startServe` blocks until a signal fires.
- **Store** is the persistence boundary (sqlite via Bun PAL). It is created at a runtime user path,
  not read from the binary — so it survives single-file compilation unchanged.
- **Transport** ships a typed boundary where `Ssh/Local/Network` perform real `connect/exec/facts`
   over a `Connection`; Http has connect but its gRPC capability is deferred (see
   `architecture/connectivity.md`). See `src/cli/connections.ts` for the host factory.
- **Modules** provide idempotency-by-default building blocks (`describe`/`converge`) consumed live by
   the executor.

## Honesty note
Per `AGENTS.md`, templating (Jinja `{{ }}` kept literal), Http transport (gRPC deferred), plugin SDK,
and scheduler/cron/webhooks/UI are genuinely scaffolded and must never be asserted as functional.
The executor, SSH/Local/Network transports, and facts-collection ARE implemented: `playbook run`
applies state over SSH/local transports. Never claim any scaffolded item above applies real remote state.
