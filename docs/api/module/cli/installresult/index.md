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

<SourceLink href="/source/src/cli/types-ts/#L236" label="types.ts:236" />

Result of `rolecall install`: plan plus what was (or would be) written.

---

## Properties

<MemberHeading id="applied" depth="3" name="applied" sig="applied: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L239" sourceLabel="types.ts:239" />

<MemberHeading id="command" depth="3" name="command" sig="command: 'install'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L237" sourceLabel="types.ts:237" />

<MemberHeading id="plan" depth="3" name="plan" sig="plan: InstallPlan" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L238" sourceLabel="types.ts:238" />

<MemberHeading id="warnings" depth="3" name="warnings" sig="warnings: string[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L241" sourceLabel="types.ts:241" />

<MemberHeading id="written" depth="3" name="written" sig="written: string[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L240" sourceLabel="types.ts:240" />
