---
title: CreateRunInput
kind: interface
longname: module:store.CreateRunInput
description: Input for creating a run. When id is omitted the repository assigns one.
---

# CreateRunInput

<Signature
  code="interface CreateRunInput {
	actionType: string;
	finishedAt?: number;
	id?: string;
	payload?: Record<string, unknown>;
	projectId?: string;
	resultSummary?: string;
	startedAt?: number;
	status?: string;
	targetIds?: string[];
}"
/>

<SourceLink href="/source/src/store/types-ts/#L161" label="types.ts:161" />

Input for creating a run. When `id` is omitted the repository assigns one.

---

## Properties

<MemberHeading id="actiontype" depth="3" name="actionType" sig="actionType: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L164" sourceLabel="types.ts:164" />

<MemberHeading id="finishedat" depth="3" name="finishedAt" sig="finishedAt: number" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L169" sourceLabel="types.ts:169" />

<MemberHeading id="id" depth="3" name="id" sig="id: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L162" sourceLabel="types.ts:162" />

<MemberHeading id="payload" depth="3" name="payload" sig="payload: Record<string, unknown>" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L170" sourceLabel="types.ts:170" />

<MemberHeading id="projectid" depth="3" name="projectId" sig="projectId: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L163" sourceLabel="types.ts:163" />

<MemberHeading id="resultsummary" depth="3" name="resultSummary" sig="resultSummary: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L167" sourceLabel="types.ts:167" />

<MemberHeading id="startedat" depth="3" name="startedAt" sig="startedAt: number" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L168" sourceLabel="types.ts:168" />

<MemberHeading id="status" depth="3" name="status" sig="status: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L166" sourceLabel="types.ts:166" />

<MemberHeading id="targetids" depth="3" name="targetIds" sig="targetIds: string[]" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L165" sourceLabel="types.ts:165" />
