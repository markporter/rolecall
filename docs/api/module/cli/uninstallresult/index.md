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

<SourceLink href="/source/src/cli/types-ts/#L253" label="types.ts:253" />

Result of `rolecall uninstall`.

---

## Properties

<MemberHeading id="applied" depth="3" name="applied" sig="applied: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L256" sourceLabel="types.ts:256" />

<MemberHeading id="command" depth="3" name="command" sig="command: 'uninstall'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L254" sourceLabel="types.ts:254" />

<MemberHeading id="kept" depth="3" name="kept" sig="kept: string[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L258" sourceLabel="types.ts:258" />

<MemberHeading id="plan" depth="3" name="plan" sig="plan: UninstallPlan" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L255" sourceLabel="types.ts:255" />

<MemberHeading id="removed" depth="3" name="removed" sig="removed: string[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L257" sourceLabel="types.ts:257" />

<MemberHeading id="service" depth="3" name="service" sig="service: { command: ServiceCommand; status: number | null; stderr?: string; stdout?: string }[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L259" sourceLabel="types.ts:259" />
