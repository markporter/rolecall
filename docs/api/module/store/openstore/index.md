---
title: openStore
kind: function
longname: module:store.openStore
description: Open (creating if needed) the durable registry and return its typed API. Backend selection reads ROLECALL_DB_BACKEND through loadConfig() (default sqlite). The sqlite handle is runtime-selected via the PAL (bun:sqlite on Bun, node:sqlite on Node), so this works under both runtimes.
---

# openStore

<Signature code="openStore(opts?: OpenStoreOptions): Store" />

<SourceLink href="/source/src/store/store-ts/#L135" label="store.ts:135" />

Open (creating if needed) the durable registry and return its typed API. Backend selection reads ROLECALL_DB_BACKEND through loadConfig() (default sqlite). The sqlite handle is runtime-selected via the PAL (bun:sqlite on Bun, node:sqlite on Node), so this works under both runtimes.

**Parameters**

- `opts` ([OpenStoreOptions](/module/store/openstoreoptions), optional) — Optional resolution options; an explicit `dbBackend` overrides the env value.

**Returns**

- [`Store`](/module/store/store) — A live Store whose repositories are backed by the PAL SqliteDb over the chosen backend. TODO(ROLECALL-PLACEHOLDER): Postgres deferred (no fallback)

**Throws**

- If `postgres` is requested (deferred, no fallback).
