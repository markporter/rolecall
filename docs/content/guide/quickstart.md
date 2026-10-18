---
title: Quickstart
---

This page gets you from zero to a working RoleCall invocation quickly. It walks through confirming the CLI responds, resolving an inventory against a tiny playbook, applying it over SSH or local transports, and starting the orchestrator server. Nothing here oversells capabilities still left `[deferred]` — scheduler/cron/webhooks/UI, the plugin SDK, and literal Jinja rendering — so the guide focuses on what works today.

## Confirm the CLI is alive

With RoleCall installed, help prints immediately:

```sh
rolecall --help
```

You should see the global flag list followed by the subcommands (`playbook`, `facts`, `inventory`, `plugin`). If you have not installed RoleCall yet, `npx rolecall --help` runs the same thing without a global install. A quick `rolecall --version` reports the current package version.

## Apply a playbook

A playbook lists hosts and ordered tasks; an inventory names those hosts and holds their variables. Create both files, then ask RoleCall to resolve the play with `rolecall playbook run <file> [--inventory <inv>]`; the example below uses concrete filenames:

```sh
rolecall playbook run playbook.yaml --inventory inventory.yaml
```

RoleCall parses argv, resolves the inventory into matched hosts plus per-host vars, and applies each task live over SSH or local transports through its built connection (`rolecall_connection` selects ssh|local|network); flags like `--limit`, `--force`, `--check`, and `--diff` shape real convergence. Add `--output json` for machine-readable output. Resolving the inventory correctly first always matters, so make sure those hosts look right before relying on the applied results.

## Start the orchestrator server

For long-running use RoleCall also runs as a server process:

```sh
rolecall --serve           # start the orchestrator HTTP server
```

By default it listens on `127.0.0.1:8080`; override the port with `--port` (env `ROLECALL_SERVE_PORT`) and the address with `--host` (env `ROLECALL_SERVE_HOST`). Point `--dist` or `--ui-dist` at a directory to serve a pluggable SPA, or leave it unset to get a zero-build health JSON back on `GET /`. Serve mode boots the durable SQLite store, which works on both Node and Bun (ADR 0019); under Node, `node:sqlite` prints a one-time `ExperimentalWarning` to stderr on first use. The orchestrator subsystem the README marks as not yet fully built, so think of it as early-access plumbing rather than a finished control plane.

## Where to go next

Pair this with [Install](/guide/install) for setup details and [First Playbook](/guide/first-playbook) for writing valid YAML. Everything referenced here reflects implemented behavior: inventory resolution, live application over SSH/local transports, fact collection, and structured templating. Arguments do not auto-render Jinja `{{ }}` (a literal `{{ }}` is passed through verbatim); the one opt-in Jinja path is the `copy` module's `content` template spec with `engine: jinja`.
