---
title: LoadConfigOptions
kind: interface
longname: module:config.LoadConfigOptions
description: Options for loadConfig; file paths/env are injectable for tests and server child processes.
---

# LoadConfigOptions

<Signature
  code="interface LoadConfigOptions {
	env?: Record<string, string | undefined>;
	projectEnvFile?: string;
	projectRoot?: string;
	systemEnvFile?: string;
	userEnvFile?: string;
}"
/>

<SourceLink href="/source/src/config/env-ts/#L84" label="env.ts:84" />

Options for loadConfig; file paths/env are injectable for tests and server child processes.

---

## Properties

<MemberHeading id="env" depth="3" name="env" sig="env: Record<string, string | undefined>" />

<MemberMeta sourceHref="/source/src/config/env-ts/#L92" sourceLabel="env.ts:92" />

Environment overrides merged last (defaults to process.env).

<MemberHeading id="projectenvfile" depth="3" name="projectEnvFile" sig="projectEnvFile: string" />

<MemberMeta sourceHref="/source/src/config/env-ts/#L90" sourceLabel="env.ts:90" />

<MemberHeading id="projectroot" depth="3" name="projectRoot" sig="projectRoot: string" />

<MemberMeta sourceHref="/source/src/config/env-ts/#L86" sourceLabel="env.ts:86" />

Project root for `<project>/.rolecall/rolecall.env` (defaults to cwd).

<MemberHeading id="systemenvfile" depth="3" name="systemEnvFile" sig="systemEnvFile: string" />

<MemberMeta sourceHref="/source/src/config/env-ts/#L88" sourceLabel="env.ts:88" />

Override system/user/project env-file paths (tests).

<MemberHeading id="userenvfile" depth="3" name="userEnvFile" sig="userEnvFile: string" />

<MemberMeta sourceHref="/source/src/config/env-ts/#L89" sourceLabel="env.ts:89" />
