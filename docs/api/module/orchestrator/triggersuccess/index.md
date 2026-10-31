---
title: TriggerSuccess
kind: interface
longname: module:orchestrator.TriggerSuccess
description: Stable JSON envelope returned by every run-trigger endpoint on success.
---

# TriggerSuccess

<Signature
  code="interface TriggerSuccess {
	runId: string;
	self: string;
	status: 'queued';
	type: ActionType;
}"
/>

<SourceLink href="/source/src/orchestrator/types-ts/#L115" label="types.ts:115" />

Stable JSON envelope returned by every run-trigger endpoint on success.

---

## Properties

<MemberHeading id="runid" depth="3" name="runId" sig="runId: string" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L116" sourceLabel="types.ts:116" />

<MemberHeading id="self" depth="3" name="self" sig="self: string" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L119" sourceLabel="types.ts:119" />

<MemberHeading id="status" depth="3" name="status" sig="status: 'queued'" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L117" sourceLabel="types.ts:117" />

<MemberHeading id="type" depth="3" name="type" sig="type: ActionType" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L118" sourceLabel="types.ts:118" />
