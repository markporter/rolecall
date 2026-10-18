---
title: Install
---

RoleCall is dual-runtime config management and orchestration. This page covers how to get the tool onto a host where you can actually run it, then points at the two usual routes people take: straight from source while contributing, or as a published package from npm.

## Requirements

Two runtimes, two channels. For the **npm install** the requirement is Node.js 22.19.0 or newer, and no Bun is needed. For compiled binaries and for running from a source checkout you want [Bun](https://bun.sh) 1.4.2 or newer. The engines floor exists because p-retry 8 requires Node 22, `node:sqlite` (used by the Node SQLite PAL) is unflagged since 22.13, and Node 20 is end-of-life.

## Installing for local development

If you are contributing or want to run RoleCall straight out of a checkout, install dependencies from the lockfile:

```sh
bun install          # installs deps from bun.lock (--frozen-lockfile in CI)
```

That fills `node_modules` and leaves you able to invoke the CLI directly from `src/cli/index.ts` through the `bin/rolecall.js` shim described next. In CI the same effect comes from `bun install --frozen-lockfile`, which refuses to rewrite the lockfile instead of trusting it.

## Installing the published package

The npm package runs on Node.js, so a machine with Node >= 22.19.0 and no Bun is enough:

```sh
# Global CLI available on PATH
npm i -g rolecall

# Or run it without installing
npx rolecall --help

# Or, project-local, if you live inside the Bun ecosystem
bun add rolecall
```

What npm ships is a Node bundle (`lib/cli.js`) built by `bun run build:js` (`node scripts/build-js.mjs`); `prepack` runs that build automatically so the baked version always matches the release. Either install route makes the `rolecall` command reachable wherever you call it. Head over to [Quickstart](/guide/quickstart) for what to type after installation finishes.

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

Read this honestly about what happens when you run RoleCall. Inventory parsing, playbook loading, and structural validation all hold today, and planning **and** execution are also live now: `playbook run` applies tasks over SSH and local transports, and `facts gather` collects targeted/cached facts for each resolved host (graceful on unreachable ones). The executor, the SSH/Local/Network transports, `vars list`/`trace`, `docs search`, `plugin list`/`register`, the `sql` builtin, and the durable SQLite store all work on **both** Node and Bun — the store opens a runtime-selected synchronous sqlite handle through the PAL (`bun:sqlite` under Bun, `node:sqlite` under Node), so `--serve`, `--trace`, `--profile`, and `run replay` work on Node too (ADR 0019). The genuinely scaffolded parts — don't treat these as functional — are the scheduler / cron / webhooks / SPA UI route registry, the richer plugin SDK authoring surface (`plugin list`/`register` are implemented), the full Jinja `{{ }}` renderer (only structured `$var`/`$concat`/`$call` + typed `when`/`loop` exist), and the Postgres backend (record-only).

One runtime note: under Node the store runs on `node:sqlite`, which prints a one-time `ExperimentalWarning` to stderr on first use — expected.
