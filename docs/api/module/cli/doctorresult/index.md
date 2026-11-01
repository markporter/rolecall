---
title: DoctorResult
kind: interface
longname: module:cli.DoctorResult
description: "Result of rolecall doctor : local isolation backend discovery."
---

# DoctorResult

<Signature
  code="interface DoctorResult {
	command: 'doctor';
	install: { binDir: string; cacheDir: string; configDir: string; envFile: string; envFileExists: boolean; platform: string; programDir: string; scope: InstallScope; stateDir: string };
	isolation: IsolationProbe;
	note: string;
}"
/>

<SourceLink href="/source/src/cli/types-ts/#L213" label="types.ts:213" />

Result of `rolecall doctor`: local isolation backend discovery.

---

## Properties

<MemberHeading id="command" depth="3" name="command" sig="command: 'doctor'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L214" sourceLabel="types.ts:214" />

<MemberHeading id="install" depth="3" name="install" sig="install: { binDir: string; cacheDir: string; configDir: string; envFile: string; envFileExists: boolean; platform: string; programDir: string; scope: InstallScope; stateDir: string }" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L217" sourceLabel="types.ts:217" />

ADR 0023 install layout that subsequent commands would use.

**Properties**

- `binDir` (string)
- `cacheDir` (string)
- `configDir` (string)
- `envFile` (string)
- `envFileExists` (boolean)
- `platform` (string)
- `programDir` (string)
- `scope` (InstallScope)
- `stateDir` (string)

<MemberHeading id="isolation" depth="3" name="isolation" sig="isolation: IsolationProbe" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L215" sourceLabel="types.ts:215" />

<MemberHeading id="note" depth="3" name="note" sig="note: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L228" sourceLabel="types.ts:228" />
