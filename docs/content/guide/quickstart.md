---
title: Quickstart
---

This page gets you from zero to a working RoleCall invocation quickly. It walks through confirming the CLI responds, resolving an inventory against a tiny playbook, applying it over SSH or local transports, and starting the orchestrator server. Nothing here oversells capabilities still left `[deferred]` — the SPA UI, serve-side executor parity, the plugin SDK authoring surface, and literal Jinja rendering — so the guide focuses on what works today.

## Confirm the CLI is alive

With RoleCall installed, help prints immediately:

```sh
rolecall --help
```

You should see the global flag list followed by the subcommands (`playbook`, `facts`, `inventory`, `plugin`). If you have not installed RoleCall yet, `npx @rolecall/cli --help` runs the same thing without a global install. A quick `rolecall --version` reports the current package version.

## Apply a playbook

A playbook lists hosts and ordered tasks; an inventory names those hosts and holds their variables. Create both files, then ask RoleCall to resolve the play with `rolecall playbook run <file> [--inventory <inv>]`; the example below uses concrete filenames:

```sh
rolecall playbook run playbook.yaml --inventory inventory.yaml
```

RoleCall parses argv, resolves the inventory into matched hosts plus per-host vars, and applies each task live over SSH or local transports through its built connection (`rolecall_connection` selects ssh|local|network); `--limit`, `--forks`, `--tags`, and `--skip-tags` shape execution, while `--force` bypasses idempotency skips. `--check` is a global dry-run: check-capable modules report would-change without converging (custom modules without check support are skipped); add `--diff` to print an observed-vs-desired patch. Add `--output json` for machine-readable output. Resolving the inventory correctly first always matters, so make sure those hosts look right before relying on the applied results.

## Start the orchestrator server

For long-running use RoleCall also runs as a server process:

```sh
rolecall --serve           # start the orchestrator HTTP server
```

By default it listens on `127.0.0.1:8080`; override the port with `--port` (env `ROLECALL_SERVE_PORT`) and the address with `--host` (env `ROLECALL_SERVE_HOST`). Point `--dist` or `--ui-dist` at a directory to serve a pluggable SPA, or leave it unset to get a zero-build health JSON back on `GET /`. Serve mode boots the durable SQLite store, which works on both Node and Bun (ADR 0019); under Node, `node:sqlite` prints a one-time `ExperimentalWarning` to stderr on first use. The server accepts run dispatch (`POST /run`), project/schedule CRUD, Bearer-gated webhooks (`POST /webhook`, `POST /api/run`), and arms a cron scheduler that fires durable schedules through the engine. Server-side dispatch executes over real transports but still uses a simplified per-target runner rather than the full CLI executor, so roles, `when`/`loop`, handlers, and tx/checkpoint apply only to CLI runs today.

## Where to go next

Pair this with [Install](/guide/install) for setup details and [First Playbook](/guide/first-playbook) for writing valid YAML. Everything referenced here reflects implemented behavior: inventory resolution, live application over SSH/local transports, fact collection, and structured templating. Arguments do not auto-render Jinja `{{ }}` (a literal `{{ }}` is passed through verbatim); the one opt-in Jinja path is the `copy` module's `content` template spec with `engine: jinja`.
