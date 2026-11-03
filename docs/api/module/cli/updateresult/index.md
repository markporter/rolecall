---
title: UpdateResult
kind: interface
longname: module:cli.UpdateResult
description: Result of rolecall update .
---

# UpdateResult

<Signature
  code="interface UpdateResult {
	applied: boolean;
	backup?: string;
	check?: UpdateCheck;
	command: 'update';
	fromVersion?: string;
	plan?: UpdatePlan;
	rolledBack?: boolean;
	service: { command: ServiceCommand; status: number | null; stderr?: string; stdout?: string }[];
	toVersion?: string;
	written: string[];
}"
/>

<SourceLink href="/source/src/cli/types-ts/#L271" label="types.ts:271" />

Result of `rolecall update`.

---

## Properties

<MemberHeading id="applied" depth="3" name="applied" sig="applied: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L275" sourceLabel="types.ts:275" />

<MemberHeading id="backup" depth="3" name="backup" sig="backup: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L280" sourceLabel="types.ts:280" />

<MemberHeading id="check" depth="3" name="check" sig="check: UpdateCheck" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L273" sourceLabel="types.ts:273" />

<MemberHeading id="command" depth="3" name="command" sig="command: 'update'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L272" sourceLabel="types.ts:272" />

<MemberHeading id="fromversion" depth="3" name="fromVersion" sig="fromVersion: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L276" sourceLabel="types.ts:276" />

<MemberHeading id="plan" depth="3" name="plan" sig="plan: UpdatePlan" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L274" sourceLabel="types.ts:274" />

<MemberHeading id="rolledback" depth="3" name="rolledBack" sig="rolledBack: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L281" sourceLabel="types.ts:281" />

<MemberHeading id="service" depth="3" name="service" sig="service: { command: ServiceCommand; status: number | null; stderr?: string; stdout?: string }[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L279" sourceLabel="types.ts:279" />

<MemberHeading id="toversion" depth="3" name="toVersion" sig="toVersion: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L277" sourceLabel="types.ts:277" />

<MemberHeading id="written" depth="3" name="written" sig="written: string[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L278" sourceLabel="types.ts:278" />
