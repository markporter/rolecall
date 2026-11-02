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

<SourceLink href="/source/src/cli/types-ts/#L262" label="types.ts:262" />

---

## Properties

<MemberHeading id="command" depth="3" name="command" sig="command: 'doctor'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L263" sourceLabel="types.ts:263" />

<MemberHeading id="install" depth="3" name="install" sig="install: { binDir: string; cacheDir: string; configDir: string; envFile: string; envFileExists: boolean; platform: string; programDir: string; scope: InstallScope; stateDir: string }" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L266" sourceLabel="types.ts:266" />

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

<MemberMeta sourceHref="/source/src/cli/types-ts/#L264" sourceLabel="types.ts:264" />

<MemberHeading id="note" depth="3" name="note" sig="note: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L277" sourceLabel="types.ts:277" />
