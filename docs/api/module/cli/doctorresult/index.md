---
title: DoctorResult
kind: interface
longname: module:cli.DoctorResult
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

<SourceLink href="/source/src/cli/types-ts/#L293" label="types.ts:293" />

---

## Properties

<MemberHeading id="command" depth="3" name="command" sig="command: 'doctor'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L294" sourceLabel="types.ts:294" />

<MemberHeading id="install" depth="3" name="install" sig="install: { binDir: string; cacheDir: string; configDir: string; envFile: string; envFileExists: boolean; platform: string; programDir: string; scope: InstallScope; stateDir: string }" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L297" sourceLabel="types.ts:297" />

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

<MemberMeta sourceHref="/source/src/cli/types-ts/#L295" sourceLabel="types.ts:295" />

<MemberHeading id="note" depth="3" name="note" sig="note: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L308" sourceLabel="types.ts:308" />
