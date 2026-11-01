---
title: RunRecord
kind: interface
longname: module:orchestrator.RunRecord
description: Durable-ish run record kept in-memory keyed by runId (+ persisted to store).
---

# RunRecord

<Signature
  code="interface RunRecord {
	dispatchCount: number;
	error?: string;
	finishedAt?: number;
	id: string;
	jobType: ActionType;
	outcomes: HostOutcome[];
	startedAt: number;
	status: RunStatus;
}"
/>

<SourceLink href="/source/src/orchestrator/types-ts/#L101" label="types.ts:101" />

Durable-ish run record kept in-memory keyed by runId (+ persisted to store).

---

## Properties

<MemberHeading id="dispatchcount" depth="3" name="dispatchCount" sig="dispatchCount: number" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L109" sourceLabel="types.ts:109" />

<MemberHeading id="error" depth="3" name="error" sig="error: string" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L108" sourceLabel="types.ts:108" />

<MemberHeading id="finishedat" depth="3" name="finishedAt" sig="finishedAt: number" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L106" sourceLabel="types.ts:106" />

<MemberHeading id="id" depth="3" name="id" sig="id: string" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L102" sourceLabel="types.ts:102" />

<MemberHeading id="jobtype" depth="3" name="jobType" sig="jobType: ActionType" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L103" sourceLabel="types.ts:103" />

<MemberHeading id="outcomes" depth="3" name="outcomes" sig="outcomes: HostOutcome[]" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L107" sourceLabel="types.ts:107" />

<MemberHeading id="startedat" depth="3" name="startedAt" sig="startedAt: number" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L105" sourceLabel="types.ts:105" />

<MemberHeading id="status" depth="3" name="status" sig="status: RunStatus" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L104" sourceLabel="types.ts:104" />
