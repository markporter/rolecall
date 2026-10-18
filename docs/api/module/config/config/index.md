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

<SourceLink href="/source/src/config/env-ts/#L32" label="env.ts:32" />

Merged, typed runtime configuration derived from the environment + safe defaults.

---

## Properties

<MemberHeading id="dbbackend" depth="3" name="dbBackend" sig="dbBackend: DbBackend" />

<MemberMeta sourceHref="/source/src/config/env-ts/#L34" sourceLabel="env.ts:34" />

Database backend selector. Default "sqlite". "postgres" is recorded only; wiring is deferred.

<MemberHeading id="dburl" depth="3" name="dbUrl" sig="dbUrl: string" />

<MemberMeta sourceHref="/source/src/config/env-ts/#L36" sourceLabel="env.ts:36" />

Optional direct database URL (ROLECALL_DB_URL). Empty string normalizes to undefined.

<MemberHeading id="home" depth="3" name="home" sig="home: string" />

<MemberMeta sourceHref="/source/src/config/env-ts/#L46" sourceLabel="env.ts:46" />

ROLECALL_HOME override (\~/.rolecall global home root when unset).

<MemberHeading id="projectgiturl" depth="3" name="projectGitUrl" sig="projectGitUrl: string" />

<MemberMeta sourceHref="/source/src/config/env-ts/#L38" sourceLabel="env.ts:38" />

Optional git URL for a remote project source (ROLECALL_PROJECT_GIT_URL). Empty string normalizes to undefined.

<MemberHeading id="projectstate" depth="3" name="projectState" sig="projectState: string" />

<MemberMeta sourceHref="/source/src/config/env-ts/#L48" sourceLabel="env.ts:48" />

ROLECALL_PROJECT_STATE override for the state-root precedence chain.

<MemberHeading id="runtime" depth="3" name="runtime" sig="runtime: string" />

<MemberMeta sourceHref="/source/src/config/env-ts/#L50" sourceLabel="env.ts:50" />

ROLECALL_RUNTIME override consumed by detectRuntime().

<MemberHeading id="scratch" depth="3" name="scratch" sig="scratch: ScratchStrategy" />

<MemberMeta sourceHref="/source/src/config/env-ts/#L40" sourceLabel="env.ts:40" />

Scratch-storage strategy. Default "fs".

<MemberHeading id="scratchdir" depth="3" name="scratchDir" sig="scratchDir: string" />

<MemberMeta sourceHref="/source/src/config/env-ts/#L42" sourceLabel="env.ts:42" />

Directory backing fs scratch. Defaults to os.tmpdir(); empty/unset ROLECALL_SCRATCH_DIR falls back there too.

<MemberHeading id="serve" depth="3" name="serve" sig="serve: ServeConfig" />

<MemberMeta sourceHref="/source/src/config/env-ts/#L44" sourceLabel="env.ts:44" />

Orchestrator bind settings.
