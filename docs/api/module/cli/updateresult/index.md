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
	delegated?: PackageManagerCommand;
	fromVersion?: string;
	plan?: UpdatePlan;
	rolledBack?: boolean;
	service: { command: ServiceCommand; status: number | null; stderr?: string; stdout?: string }[];
	toVersion?: string;
	written: string[];
}"
/>

<SourceLink href="/source/src/cli/types-ts/#L279" label="types.ts:279" />

Result of `rolecall update`.

---

## Properties

<MemberHeading id="applied" depth="3" name="applied" sig="applied: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L283" sourceLabel="types.ts:283" />

<MemberHeading id="backup" depth="3" name="backup" sig="backup: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L288" sourceLabel="types.ts:288" />

<MemberHeading id="check" depth="3" name="check" sig="check: UpdateCheck" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L281" sourceLabel="types.ts:281" />

<MemberHeading id="command" depth="3" name="command" sig="command: 'update'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L280" sourceLabel="types.ts:280" />

<MemberHeading id="delegated" depth="3" name="delegated" sig="delegated: PackageManagerCommand" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L290" sourceLabel="types.ts:290" />

<MemberHeading id="fromversion" depth="3" name="fromVersion" sig="fromVersion: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L284" sourceLabel="types.ts:284" />

<MemberHeading id="plan" depth="3" name="plan" sig="plan: UpdatePlan" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L282" sourceLabel="types.ts:282" />

<MemberHeading id="rolledback" depth="3" name="rolledBack" sig="rolledBack: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L289" sourceLabel="types.ts:289" />

<MemberHeading id="service" depth="3" name="service" sig="service: { command: ServiceCommand; status: number | null; stderr?: string; stdout?: string }[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L287" sourceLabel="types.ts:287" />

<MemberHeading id="toversion" depth="3" name="toVersion" sig="toVersion: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L285" sourceLabel="types.ts:285" />

<MemberHeading id="written" depth="3" name="written" sig="written: string[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L286" sourceLabel="types.ts:286" />
