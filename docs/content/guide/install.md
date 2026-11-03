---
title: Install
---

RoleCall is dual-runtime config management and orchestration. This page covers how to get the tool onto a host where you can actually run it, then points at the two usual routes people take: the published npm package for normal use, or a source checkout while contributing.

## Requirements

Two runtimes, two channels. For the **npm install** the requirement is Node.js 22.19.0 or newer, and no Bun is needed. For compiled binaries and for running from a source checkout you want [Bun](https://bun.sh) 1.4.2 or newer. The engines floor exists because p-retry 8 requires Node 22, `node:sqlite` (used by the Node SQLite PAL) is unflagged since 22.13, and Node 20 is end-of-life.

## Installing the published package

The npm package runs on Node.js, so a machine with Node >= 22.19.0 and no Bun is enough:

```sh
# Global CLI available on PATH
npm i -g @rolecall/cli

# Or run it without installing
npx @rolecall/cli --help

# Or, project-local, if you live inside the Bun ecosystem
bun add @rolecall/cli
```

What npm ships is a Node bundle (`lib/cli.js`) built by `bun run build:js` (`node scripts/build-js.mjs`); `prepack` runs that build automatically so the baked version always matches the release. Either install route makes the `rolecall` command reachable wherever you call it. Head over to [Quickstart](/guide/quickstart) for what to type after installation finishes. The other channels, including standalone binaries attached to each GitHub Release, are covered in [Ways to run RoleCall](/deployment/ways-to-run).

## Bootstrap the self-contained binary

On a host without Node/npm/Bun, use the Node-free bootstrap:

```sh
# Interactive wizard
curl -fsSL https://raw.githubusercontent.com/markporter/rolecall/main/install.sh | sh

# Pre-answer the scope; paths/service/confirmation still prompt
curl -fsSL https://raw.githubusercontent.com/markporter/rolecall/main/install.sh | sh -s -- --user

# Unattended
curl -fsSL https://raw.githubusercontent.com/markporter/rolecall/main/install.sh | sh -s -- --non-interactive --yes --user
```

It resolves the latest GitHub Release, downloads the platform binary and
`SHA256SUMS`, verifies the checksum, and runs `<binary> install --from-dir ...`.
In an interactive terminal the CLI then walks through scope, paths, service, and
confirmation. Windows uses `install.ps1` with the same flags.

The bootstrap verifies the artifact checksum; the installed binary embeds the
release verification key and enforces the signed update manifests (ADR 0029).

## Installing for local development

If you are contributing or want to run RoleCall straight out of a checkout, install dependencies from the lockfile:

```sh
bun install          # installs deps from bun.lock (--frozen-lockfile in CI)
```

That fills `node_modules` and leaves you able to invoke the CLI directly from `src/cli/index.ts` through the `bin/rolecall.js` shim described next. In CI the same effect comes from `bun install --frozen-lockfile`, which refuses to rewrite the lockfile instead of trusting it.

## Running from source

While developing straight from the repo you do not need anything installed globally. Print usage like this:

```sh
bun run src/cli/index.ts --help
# or, via the bin shim
bun bin/rolecall.js --help
```

Two other commands stay useful throughout development:

```sh
bun test             # primary runner, Bun-native bun:test
bun run build        # -> bunx tsc --noEmit
```

`bun test` runs the smoke suite, and `bun run build` simply forwards to `bunx tsc --noEmit` to confirm types hold.

## Engine status

Execution is live on both Node.js and Bun. `playbook run` applies tasks over SSH, local, and network transports, and `facts gather` collects targeted/cached facts for each resolved host (gracefully, even when a host is unreachable). The executor, the SSH/Local/Network transports, `vars list`/`trace`, `docs search`, `plugin list`/`register`, the `sql` builtin, and the durable SQLite store all work on **both** runtimes: the store opens a runtime-selected synchronous sqlite handle through the PAL (`bun:sqlite` under Bun, `node:sqlite` under Node), so `--serve`, `--trace`, `--profile`, and `run replay` work on Node too (ADR 0019). The orchestrator implements run dispatch over real transports, project/schedule CRUD, a cron scheduler, webhooks, and forked full-executor playbook runs (each run forks `playbook run -o jsonl` against a materialized playbook/inventory, so roles, phases, `when`/`loop`, handlers, tx, and check/diff/force apply).

Two deliberate design choices are worth knowing up front. Jinja `{{ }}` is not interpolated in ordinary playbook scalars: structured `$var`/`$concat`/`$call` plus typed `when`/`loop` are the native path, and Jinja renders only through explicit `copy` content templates with `engine: jinja` or `.j2` files. The orchestrator serves a UI directory you supply with `--ui-dist` rather than bundling a SPA. Persistence is SQLite on both runtimes.

One runtime note: under Node the store runs on `node:sqlite`, which prints a one-time `ExperimentalWarning` to stderr on first use — expected.
