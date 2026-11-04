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

<SourceLink href="/source/src/cli/types-ts/#L269" label="types.ts:269" />

Result of `rolecall uninstall`.

---

## Properties

<MemberHeading id="applied" depth="3" name="applied" sig="applied: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L272" sourceLabel="types.ts:272" />

<MemberHeading id="command" depth="3" name="command" sig="command: 'uninstall'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L270" sourceLabel="types.ts:270" />

<MemberHeading id="kept" depth="3" name="kept" sig="kept: string[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L274" sourceLabel="types.ts:274" />

<MemberHeading id="plan" depth="3" name="plan" sig="plan: UninstallPlan" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L271" sourceLabel="types.ts:271" />

<MemberHeading id="removed" depth="3" name="removed" sig="removed: string[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L273" sourceLabel="types.ts:273" />

<MemberHeading id="service" depth="3" name="service" sig="service: { command: ServiceCommand; status: number | null; stderr?: string; stdout?: string }[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L275" sourceLabel="types.ts:275" />
