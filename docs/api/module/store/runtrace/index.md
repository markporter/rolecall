---
title: RunTrace
kind: interface
longname: module:store.RunTrace
description: "A single execution-trace ledger row (Todo 25). Records one task/iteration event for a run with timing + outcome, enabling replay, failure-locality, and per-task/per-host performance profiling. detail is a flexible JSON column so later todos (26: tx_id / checkpoint) can extend the ledger without a migration. Todo 26 additionally carries txId + checkpointId as first-class columns so a run's applied deltas can be grouped into dependent transactions / checkpoints for rollback + resume (see src/executor/tx.ts)."
---

# RunTrace

<Signature
  code="interface RunTrace {
	checkpointId?: string;
	detail: Record<string, unknown>;
	durationMs: number | null;
	endedAt: number | null;
	host: string;
	id: string;
	iteration: number;
	phase: string;
	runId: string;
	seq: number;
	startedAt: number;
	status: string;
	taskName: string;
	txId?: string;
}"
/>

<SourceLink href="/source/src/store/types-ts/#L68" label="types.ts:68" />

A single execution-trace ledger row (Todo 25). Records one task/iteration event for a run with timing + outcome, enabling replay, failure-locality, and per-task/per-host performance profiling. `detail` is a flexible JSON column so later todos (26: tx_id / checkpoint) can extend the ledger without a migration. Todo 26 additionally carries `txId` + `checkpointId` as first-class columns so a run's applied deltas can be grouped into dependent transactions / checkpoints for rollback + resume (see src/executor/tx.ts).

---

## Properties

<MemberHeading id="checkpointid" depth="3" name="checkpointId" sig="checkpointId: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L100" sourceLabel="types.ts:100" />

Checkpoint id (Todo 26). Marks the savepoint this delta was applied under. On partial rollback only deltas applied _after_ the last reached checkpoint are undone; deltas at/before it are preserved. Absent => base checkpoint.

<MemberHeading id="detail" depth="3" name="detail" sig="detail: Record<string, unknown>" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L102" sourceLabel="types.ts:102" />

Auxiliary structured data (error message, summary, …).

<MemberHeading id="durationms" depth="3" name="durationMs" sig="durationMs: number | null" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L88" sourceLabel="types.ts:88" />

Wall-clock duration in ms (null for start rows / still running).

<MemberHeading id="endedat" depth="3" name="endedAt" sig="endedAt: number | null" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L86" sourceLabel="types.ts:86" />

Epoch-ms when the phase ended (null while running / for start rows).

<MemberHeading id="host" depth="3" name="host" sig="host: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L74" sourceLabel="types.ts:74" />

Host/target the event occurred on (empty string for host-agnostic phases).

<MemberHeading id="id" depth="3" name="id" sig="id: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L70" sourceLabel="types.ts:70" />

Surrogate primary key.

<MemberHeading id="iteration" depth="3" name="iteration" sig="iteration: number" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L78" sourceLabel="types.ts:78" />

Loop iteration index (-1 for whole-task events with no single iteration).

<MemberHeading id="phase" depth="3" name="phase" sig="phase: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L80" sourceLabel="types.ts:80" />

Lifecycle phase: start | end | when-eval | render | idempotency | module-run | register | notify.

<MemberHeading id="runid" depth="3" name="runId" sig="runId: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L72" sourceLabel="types.ts:72" />

Run this event belongs to (foreign key to runs.id, logical only).

<MemberHeading id="seq" depth="3" name="seq" sig="seq: number" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L104" sourceLabel="types.ts:104" />

Monotonic within-run ordering (assigned on write).

<MemberHeading id="startedat" depth="3" name="startedAt" sig="startedAt: number" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L84" sourceLabel="types.ts:84" />

Epoch-ms when the phase began.

<MemberHeading id="status" depth="3" name="status" sig="status: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L82" sourceLabel="types.ts:82" />

Outcome status: running | ok | failed | skipped.

<MemberHeading id="taskname" depth="3" name="taskName" sig="taskName: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L76" sourceLabel="types.ts:76" />

Task name the event is scoped to.

<MemberHeading id="txid" depth="3" name="txId" sig="txId: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L94" sourceLabel="types.ts:94" />

Transaction id (Todo 26). Plays/tasks sharing a `txId` are _dependent_: on a member failure the tx's applied ledger rows are reverse-walked and undone. Absent => the event belongs to no transaction (resumable in isolation).
