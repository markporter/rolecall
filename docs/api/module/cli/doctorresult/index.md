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

<SourceLink href="/source/src/cli/types-ts/#L242" label="types.ts:242" />

---

## Properties

<MemberHeading id="command" depth="3" name="command" sig="command: 'doctor'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L243" sourceLabel="types.ts:243" />

<MemberHeading id="install" depth="3" name="install" sig="install: { binDir: string; cacheDir: string; configDir: string; envFile: string; envFileExists: boolean; platform: string; programDir: string; scope: InstallScope; stateDir: string }" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L246" sourceLabel="types.ts:246" />

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

<MemberMeta sourceHref="/source/src/cli/types-ts/#L244" sourceLabel="types.ts:244" />

<MemberHeading id="note" depth="3" name="note" sig="note: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L257" sourceLabel="types.ts:257" />
