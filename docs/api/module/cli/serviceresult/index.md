---
title: ServiceResult
kind: interface
longname: module:cli.ServiceResult
description: Result of rolecall service .
---

# ServiceResult

<Signature
  code="interface ServiceResult {
	applied: boolean;
	command: 'service';
	plan: ServicePlan;
	results: { command: ServiceCommand; status: number | null; stderr?: string; stdout?: string }[];
}"
/>

<SourceLink href="/source/src/cli/types-ts/#L243" label="types.ts:243" />

Result of `rolecall service`.

---

## Properties

<MemberHeading id="applied" depth="3" name="applied" sig="applied: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L246" sourceLabel="types.ts:246" />

<MemberHeading id="command" depth="3" name="command" sig="command: 'service'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L244" sourceLabel="types.ts:244" />

<MemberHeading id="plan" depth="3" name="plan" sig="plan: ServicePlan" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L245" sourceLabel="types.ts:245" />

<MemberHeading id="results" depth="3" name="results" sig="results: { command: ServiceCommand; status: number | null; stderr?: string; stdout?: string }[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L247" sourceLabel="types.ts:247" />
