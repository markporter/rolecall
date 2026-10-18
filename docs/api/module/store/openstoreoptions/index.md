---
title: OpenStoreOptions
kind: interface
longname: module:store.OpenStoreOptions
description: "Options accepted by openStore(). Resolution precedence: an explicit dbBackend , then ROLECALL_DB_BACKEND via loadConfig(), defaults to sqlite — a postgres value throws (deferred). Then dbPath > /.rolecall > global ~/.rolecall (ROLECALL_HOME/ROLECALL_PROJECT_STATE)."
---

# OpenStoreOptions

<Signature
  code="interface OpenStoreOptions {
	dbBackend?: DbBackend;
	dbPath?: string;
	projectDir?: string;
}"
/>

<SourceLink href="/source/src/store/types-ts/#L276" label="types.ts:276" />

Options accepted by openStore(). Resolution precedence: an explicit `dbBackend`, then ROLECALL_DB_BACKEND via loadConfig(), defaults to sqlite — a postgres value throws (deferred). Then dbPath > /.rolecall > global \~/.rolecall (ROLECALL_HOME/ROLECALL_PROJECT_STATE).

---

## Properties

<MemberHeading id="dbbackend" depth="3" name="dbBackend" sig="dbBackend: DbBackend" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L278" sourceLabel="types.ts:278" />

Override the database backend ("sqlite" | "postgres"). Defaults to ROLECALL_DB_BACKEND / sqlite. Postgres is deferred.

<MemberHeading id="dbpath" depth="3" name="dbPath" sig="dbPath: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L280" sourceLabel="types.ts:280" />

Explicit absolute path to the sqlite file. Highest precedence.

<MemberHeading id="projectdir" depth="3" name="projectDir" sig="projectDir: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L282" sourceLabel="types.ts:282" />

When set, state resolves under `<projectDir>/.rolecall/` (wins over global).
