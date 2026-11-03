---
title: Config
kind: interface
longname: module:config.Config
description: Merged, typed runtime configuration derived from the environment + safe defaults.
---

# Config

<Signature
  code="interface Config {
	dbBackend: DbBackend;
	dbUrl?: string;
	home?: string;
	projectGitUrl?: string;
	projectState?: string;
	runtime?: string;
	scratch: ScratchStrategy;
	scratchDir: string;
	serve: ServeConfig;
}"
/>

<SourceLink href="/source/src/config/env-ts/#L35" label="env.ts:35" />

Merged, typed runtime configuration derived from the environment + safe defaults.

---

## Properties

<MemberHeading id="dbbackend" depth="3" name="dbBackend" sig="dbBackend: DbBackend" />

<MemberMeta sourceHref="/source/src/config/env-ts/#L37" sourceLabel="env.ts:37" />

Database backend selector. Default "sqlite". "postgres" is recorded only; wiring is deferred.

<MemberHeading id="dburl" depth="3" name="dbUrl" sig="dbUrl: string" />

<MemberMeta sourceHref="/source/src/config/env-ts/#L39" sourceLabel="env.ts:39" />

Optional direct database URL (ROLECALL_DB_URL). Empty string normalizes to undefined.

<MemberHeading id="home" depth="3" name="home" sig="home: string" />

<MemberMeta sourceHref="/source/src/config/env-ts/#L49" sourceLabel="env.ts:49" />

ROLECALL_HOME override (\~/.rolecall global home root when unset).

<MemberHeading id="projectgiturl" depth="3" name="projectGitUrl" sig="projectGitUrl: string" />

<MemberMeta sourceHref="/source/src/config/env-ts/#L41" sourceLabel="env.ts:41" />

Optional git URL for a remote project source (ROLECALL_PROJECT_GIT_URL). Empty string normalizes to undefined.

<MemberHeading id="projectstate" depth="3" name="projectState" sig="projectState: string" />

<MemberMeta sourceHref="/source/src/config/env-ts/#L51" sourceLabel="env.ts:51" />

ROLECALL_PROJECT_STATE override for the state-root precedence chain.

<MemberHeading id="runtime" depth="3" name="runtime" sig="runtime: string" />

<MemberMeta sourceHref="/source/src/config/env-ts/#L53" sourceLabel="env.ts:53" />

ROLECALL_RUNTIME override consumed by detectRuntime().

<MemberHeading id="scratch" depth="3" name="scratch" sig="scratch: ScratchStrategy" />

<MemberMeta sourceHref="/source/src/config/env-ts/#L43" sourceLabel="env.ts:43" />

Scratch-storage strategy. Default "fs".

<MemberHeading id="scratchdir" depth="3" name="scratchDir" sig="scratchDir: string" />

<MemberMeta sourceHref="/source/src/config/env-ts/#L45" sourceLabel="env.ts:45" />

Directory backing fs scratch. Defaults to os.tmpdir(); empty/unset ROLECALL_SCRATCH_DIR falls back there too.

<MemberHeading id="serve" depth="3" name="serve" sig="serve: ServeConfig" />

<MemberMeta sourceHref="/source/src/config/env-ts/#L47" sourceLabel="env.ts:47" />

Orchestrator bind settings.
