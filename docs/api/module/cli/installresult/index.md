---
title: InstallResult
kind: interface
longname: module:cli.InstallResult
description: "Result of rolecall install : plan plus what was (or would be) written."
---

# InstallResult

<Signature
  code="interface InstallResult {
	applied: boolean;
	command: 'install';
	migration?: MigrationResult;
	plan: InstallPlan;
	warnings: string[];
	written: string[];
}"
/>

<SourceLink href="/source/src/cli/types-ts/#L254" label="types.ts:254" />

Result of `rolecall install`: plan plus what was (or would be) written.

---

## Properties

<MemberHeading id="applied" depth="3" name="applied" sig="applied: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L257" sourceLabel="types.ts:257" />

<MemberHeading id="command" depth="3" name="command" sig="command: 'install'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L255" sourceLabel="types.ts:255" />

<MemberHeading id="migration" depth="3" name="migration" sig="migration: MigrationResult" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L260" sourceLabel="types.ts:260" />

<MemberHeading id="plan" depth="3" name="plan" sig="plan: InstallPlan" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L256" sourceLabel="types.ts:256" />

<MemberHeading id="warnings" depth="3" name="warnings" sig="warnings: string[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L259" sourceLabel="types.ts:259" />

<MemberHeading id="written" depth="3" name="written" sig="written: string[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L258" sourceLabel="types.ts:258" />
