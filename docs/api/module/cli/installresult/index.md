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
	plan: InstallPlan;
	warnings: string[];
	written: string[];
}"
/>

<SourceLink href="/source/src/cli/types-ts/#L244" label="types.ts:244" />

Result of `rolecall install`: plan plus what was (or would be) written.

---

## Properties

<MemberHeading id="applied" depth="3" name="applied" sig="applied: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L247" sourceLabel="types.ts:247" />

<MemberHeading id="command" depth="3" name="command" sig="command: 'install'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L245" sourceLabel="types.ts:245" />

<MemberHeading id="plan" depth="3" name="plan" sig="plan: InstallPlan" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L246" sourceLabel="types.ts:246" />

<MemberHeading id="warnings" depth="3" name="warnings" sig="warnings: string[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L249" sourceLabel="types.ts:249" />

<MemberHeading id="written" depth="3" name="written" sig="written: string[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L248" sourceLabel="types.ts:248" />
