---
title: CreateTraceInput
kind: interface
longname: module:store.CreateTraceInput
description: Input for creating a trace row. id / seq are assigned when omitted.
---

# CreateTraceInput

<Signature
  code="interface CreateTraceInput {
	checkpointId?: string;
	detail?: Record<string, unknown>;
	durationMs?: number | null;
	endedAt?: number | null;
	host?: string;
	id?: string;
	iteration?: number;
	phase: string;
	runId: string;
	seq?: number;
	startedAt?: number;
	status: string;
	taskName: string;
	txId?: string;
}"
/>

<SourceLink href="/source/src/store/types-ts/#L133" label="types.ts:133" />

Input for creating a trace row. `id`/`seq` are assigned when omitted.

---

## Properties

<MemberHeading id="checkpointid" depth="3" name="checkpointId" sig="checkpointId: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L147" sourceLabel="types.ts:147" />

Checkpoint id (Todo 26); marks the savepoint this delta was applied under.

<MemberHeading id="detail" depth="3" name="detail" sig="detail: Record<string, unknown>" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L148" sourceLabel="types.ts:148" />

<MemberHeading id="durationms" depth="3" name="durationMs" sig="durationMs: number | null" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L143" sourceLabel="types.ts:143" />

<MemberHeading id="endedat" depth="3" name="endedAt" sig="endedAt: number | null" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L142" sourceLabel="types.ts:142" />

<MemberHeading id="host" depth="3" name="host" sig="host: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L136" sourceLabel="types.ts:136" />

<MemberHeading id="id" depth="3" name="id" sig="id: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L134" sourceLabel="types.ts:134" />

<MemberHeading id="iteration" depth="3" name="iteration" sig="iteration: number" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L138" sourceLabel="types.ts:138" />

<MemberHeading id="phase" depth="3" name="phase" sig="phase: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L139" sourceLabel="types.ts:139" />

<MemberHeading id="runid" depth="3" name="runId" sig="runId: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L135" sourceLabel="types.ts:135" />

<MemberHeading id="seq" depth="3" name="seq" sig="seq: number" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L149" sourceLabel="types.ts:149" />

<MemberHeading id="startedat" depth="3" name="startedAt" sig="startedAt: number" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L141" sourceLabel="types.ts:141" />

<MemberHeading id="status" depth="3" name="status" sig="status: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L140" sourceLabel="types.ts:140" />

<MemberHeading id="taskname" depth="3" name="taskName" sig="taskName: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L137" sourceLabel="types.ts:137" />

<MemberHeading id="txid" depth="3" name="txId" sig="txId: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L145" sourceLabel="types.ts:145" />

Transaction id (Todo 26); groups dependent applied deltas for rollback.
