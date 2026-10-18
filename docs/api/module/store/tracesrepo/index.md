---
title: TracesRepo
kind: interface
longname: module:store.TracesRepo
description: Typed CRUD over the run_traces ledger (Todo 25).
---

# TracesRepo

<Signature
  code="interface TracesRepo {
	create(input: CreateTraceInput): Promise<RunTrace>;
	delete(id: string): Promise<boolean>;
	get(id: string): Promise<RunTrace | null>;
	listByRun(runId: string): Promise<RunTrace[]>;
	listByRunCheckpoint(runId: string, checkpointId: string): Promise<RunTrace[]>;
	listByTx(txId: string): Promise<RunTrace[]>;
	update(id: string, patch: PatchTrace): Promise<RunTrace | null>;
}"
/>

<SourceLink href="/source/src/store/types-ts/#L233" label="types.ts:233" />

Typed CRUD over the run_traces ledger (Todo 25).

#### Implemented By

- [`TracesRepository`](/module/store/tracesrepository)

---

## Methods

<MemberHeading id="create" depth="3" name="create" sig="create(input: CreateTraceInput): Promise<RunTrace>" />

<MemberMeta badges="async" sourceHref="/source/src/store/types-ts/#L234" sourceLabel="types.ts:234" />

**Parameters**

- `input` ([CreateTraceInput](/module/store/createtraceinput))

**Returns**

- `Promise<`[`RunTrace`](/module/store/runtrace)`>`

<MemberHeading id="delete" depth="3" name="delete" sig="delete(id: string): Promise<boolean>" />

<MemberMeta badges="async" sourceHref="/source/src/store/types-ts/#L243" sourceLabel="types.ts:243" />

**Parameters**

- `id` (string)

**Returns**

- `Promise<boolean>`

<MemberHeading id="get" depth="3" name="get" sig="get(id: string): Promise<RunTrace | null>" />

<MemberMeta badges="async" sourceHref="/source/src/store/types-ts/#L235" sourceLabel="types.ts:235" />

**Parameters**

- `id` (string)

**Returns**

- `Promise<`[`RunTrace`](/module/store/runtrace)` | null>`

<MemberHeading id="listbyrun" depth="3" name="listByRun" sig="listByRun(runId: string): Promise<RunTrace[]>" />

<MemberMeta badges="async" sourceHref="/source/src/store/types-ts/#L237" sourceLabel="types.ts:237" />

All traces for a run, ordered by ascending seq (replay order).

**Parameters**

- `runId` (string)

**Returns**

- `Promise<`[`RunTrace`](/module/store/runtrace)`[]>`

<MemberHeading
  id="listbyruncheckpoint"
  depth="3"
  name="listByRunCheckpoint"
  sig="listByRunCheckpoint(
	runId: string,
	checkpointId: string,
): Promise<RunTrace[]>"
/>

<MemberMeta badges="async" sourceHref="/source/src/store/types-ts/#L241" sourceLabel="types.ts:241" />

All traces for a run under a specific checkpoint (Todo 26), ordered by ascending seq.

**Parameters**

- `runId` (string)
- `checkpointId` (string)

**Returns**

- `Promise<`[`RunTrace`](/module/store/runtrace)`[]>`

<MemberHeading id="listbytx" depth="3" name="listByTx" sig="listByTx(txId: string): Promise<RunTrace[]>" />

<MemberMeta badges="async" sourceHref="/source/src/store/types-ts/#L239" sourceLabel="types.ts:239" />

All traces for a transaction (Todo 26), ordered by descending seq (undo-walk order).

**Parameters**

- `txId` (string)

**Returns**

- `Promise<`[`RunTrace`](/module/store/runtrace)`[]>`

<MemberHeading id="update" depth="3" name="update" sig="update(id: string, patch: PatchTrace): Promise<RunTrace | null>" />

<MemberMeta badges="async" sourceHref="/source/src/store/types-ts/#L242" sourceLabel="types.ts:242" />

**Parameters**

- `id` (string)
- `patch` ([PatchTrace](/module/store/patchtrace))

**Returns**

- `Promise<`[`RunTrace`](/module/store/runtrace)` | null>`
