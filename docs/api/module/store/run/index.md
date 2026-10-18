---
title: Run
kind: interface
longname: module:store.Run
description: A persisted Run record — one orchestrator/scheduler/webhook invocation.
---

# Run

<Signature
  code="interface Run {
	actionType: string;
	finishedAt?: number;
	id: string;
	payload: Record<string, unknown>;
	projectId?: string;
	resultSummary?: string;
	startedAt: number;
	status: string;
	targetIds: string[];
}"
/>

<SourceLink href="/source/src/store/types-ts/#L47" label="types.ts:47" />

A persisted Run record — one orchestrator/scheduler/webhook invocation.

---

## Properties

<MemberHeading id="actiontype" depth="3" name="actionType" sig="actionType: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L50" sourceLabel="types.ts:50" />

<MemberHeading id="finishedat" depth="3" name="finishedAt" sig="finishedAt: number" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L55" sourceLabel="types.ts:55" />

<MemberHeading id="id" depth="3" name="id" sig="id: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L48" sourceLabel="types.ts:48" />

<MemberHeading id="payload" depth="3" name="payload" sig="payload: Record<string, unknown>" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L56" sourceLabel="types.ts:56" />

<MemberHeading id="projectid" depth="3" name="projectId" sig="projectId: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L49" sourceLabel="types.ts:49" />

<MemberHeading id="resultsummary" depth="3" name="resultSummary" sig="resultSummary: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L53" sourceLabel="types.ts:53" />

<MemberHeading id="startedat" depth="3" name="startedAt" sig="startedAt: number" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L54" sourceLabel="types.ts:54" />

<MemberHeading id="status" depth="3" name="status" sig="status: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L52" sourceLabel="types.ts:52" />

<MemberHeading id="targetids" depth="3" name="targetIds" sig="targetIds: string[]" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L51" sourceLabel="types.ts:51" />
