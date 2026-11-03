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

<SourceLink href="/source/src/cli/types-ts/#L286" label="types.ts:286" />

---

## Properties

<MemberHeading id="command" depth="3" name="command" sig="command: 'doctor'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L287" sourceLabel="types.ts:287" />

<MemberHeading id="install" depth="3" name="install" sig="install: { binDir: string; cacheDir: string; configDir: string; envFile: string; envFileExists: boolean; platform: string; programDir: string; scope: InstallScope; stateDir: string }" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L290" sourceLabel="types.ts:290" />

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

<MemberMeta sourceHref="/source/src/cli/types-ts/#L288" sourceLabel="types.ts:288" />

<MemberHeading id="note" depth="3" name="note" sig="note: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L301" sourceLabel="types.ts:301" />
