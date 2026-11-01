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

<SourceLink href="/source/src/orchestrator/types-ts/#L119" label="types.ts:119" />

Stable JSON envelope returned by every run-trigger endpoint on success.

---

## Properties

<MemberHeading id="runid" depth="3" name="runId" sig="runId: string" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L120" sourceLabel="types.ts:120" />

<MemberHeading id="self" depth="3" name="self" sig="self: string" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L123" sourceLabel="types.ts:123" />

<MemberHeading id="status" depth="3" name="status" sig="status: 'queued'" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L121" sourceLabel="types.ts:121" />

<MemberHeading id="type" depth="3" name="type" sig="type: ActionType" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L122" sourceLabel="types.ts:122" />
