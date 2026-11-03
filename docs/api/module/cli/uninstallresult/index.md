---
title: UninstallResult
kind: interface
longname: module:cli.UninstallResult
description: Result of rolecall uninstall .
---

# UninstallResult

<Signature
  code="interface UninstallResult {
	applied: boolean;
	command: 'uninstall';
	kept: string[];
	plan: UninstallPlan;
	removed: string[];
	service: { command: ServiceCommand; status: number | null; stderr?: string; stdout?: string }[];
}"
/>

<SourceLink href="/source/src/cli/types-ts/#L263" label="types.ts:263" />

Result of `rolecall uninstall`.

---

## Properties

<MemberHeading id="applied" depth="3" name="applied" sig="applied: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L266" sourceLabel="types.ts:266" />

<MemberHeading id="command" depth="3" name="command" sig="command: 'uninstall'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L264" sourceLabel="types.ts:264" />

<MemberHeading id="kept" depth="3" name="kept" sig="kept: string[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L268" sourceLabel="types.ts:268" />

<MemberHeading id="plan" depth="3" name="plan" sig="plan: UninstallPlan" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L265" sourceLabel="types.ts:265" />

<MemberHeading id="removed" depth="3" name="removed" sig="removed: string[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L267" sourceLabel="types.ts:267" />

<MemberHeading id="service" depth="3" name="service" sig="service: { command: ServiceCommand; status: number | null; stderr?: string; stdout?: string }[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L269" sourceLabel="types.ts:269" />
