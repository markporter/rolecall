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

<SourceLink href="/source/src/cli/types-ts/#L255" label="types.ts:255" />

Result of `rolecall service`.

---

## Properties

<MemberHeading id="applied" depth="3" name="applied" sig="applied: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L258" sourceLabel="types.ts:258" />

<MemberHeading id="command" depth="3" name="command" sig="command: 'service'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L256" sourceLabel="types.ts:256" />

<MemberHeading id="plan" depth="3" name="plan" sig="plan: ServicePlan" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L257" sourceLabel="types.ts:257" />

<MemberHeading id="results" depth="3" name="results" sig="results: { command: ServiceCommand; status: number | null; stderr?: string; stdout?: string }[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L259" sourceLabel="types.ts:259" />
