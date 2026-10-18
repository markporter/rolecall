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

<SourceLink href="/source/src/orchestrator/types-ts/#L93" label="types.ts:93" />

Durable-ish run record kept in-memory keyed by runId (+ persisted to store).

---

## Properties

<MemberHeading id="dispatchcount" depth="3" name="dispatchCount" sig="dispatchCount: number" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L101" sourceLabel="types.ts:101" />

<MemberHeading id="error" depth="3" name="error" sig="error: string" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L100" sourceLabel="types.ts:100" />

<MemberHeading id="finishedat" depth="3" name="finishedAt" sig="finishedAt: number" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L98" sourceLabel="types.ts:98" />

<MemberHeading id="id" depth="3" name="id" sig="id: string" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L94" sourceLabel="types.ts:94" />

<MemberHeading id="jobtype" depth="3" name="jobType" sig="jobType: ActionType" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L95" sourceLabel="types.ts:95" />

<MemberHeading id="outcomes" depth="3" name="outcomes" sig="outcomes: HostOutcome[]" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L99" sourceLabel="types.ts:99" />

<MemberHeading id="startedat" depth="3" name="startedAt" sig="startedAt: number" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L97" sourceLabel="types.ts:97" />

<MemberHeading id="status" depth="3" name="status" sig="status: RunStatus" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L96" sourceLabel="types.ts:96" />
