---
title: TracesRepository
kind: class
longname: module:store.TracesRepository
description: Typed CRUD over the run_traces ledger (Todo 25).
---

# TracesRepository

<SourceLink href="/source/src/store/traces-ts/#L35" label="traces.ts:35" />

Typed CRUD over the run_traces ledger (Todo 25).

---

## Constructors

<MemberHeading
  id="constructor"
  depth="3"
  name="constructor"
  sig="new TracesRepository(
	db: SqliteDb,
	writes: WriteQueue,
): TracesRepository"
/>

**Parameters**

- `db` (SqliteDb) — Runtime-selected synchronous sqlite connection shared with every repository.
- `writes` ([WriteQueue](/module/store/writequeue)) — Shared single-writer serialization queue owned by StoreImpl.

**Returns**

`TracesRepository`

#### Implements

- [`TracesRepo`](/module/store/tracesrepo)

---

## Methods

<MemberHeading id="create" depth="3" name="create" sig="create(input: CreateTraceInput): Promise<RunTrace>" />

<MemberMeta badges="async" sourceHref="/source/src/store/traces-ts/#L45" sourceLabel="traces.ts:45" />

_Implementation of&#x20;_[`create`](/module/store/tracesrepo#create)

**Parameters**

- `input` ([CreateTraceInput](/module/store/createtraceinput))

**Returns**

- `Promise<`[`RunTrace`](/module/store/runtrace)`>`

<MemberHeading id="delete" depth="3" name="delete" sig="delete(id: string): Promise<boolean>" />

<MemberMeta badges="async" sourceHref="/source/src/store/traces-ts/#L114" sourceLabel="traces.ts:114" />

_Implementation of&#x20;_[`delete`](/module/store/tracesrepo#delete)

**Parameters**

- `id` (string)

**Returns**

- `Promise<boolean>`

<MemberHeading id="get" depth="3" name="get" sig="get(id: string): Promise<RunTrace | null>" />

<MemberMeta badges="async" sourceHref="/source/src/store/traces-ts/#L78" sourceLabel="traces.ts:78" />

_Implementation of&#x20;_[`get`](/module/store/tracesrepo#get)

**Parameters**

- `id` (string)

**Returns**

- `Promise<`[`RunTrace`](/module/store/runtrace)` | null>`

<MemberHeading id="listbyrun" depth="3" name="listByRun" sig="listByRun(runId: string): Promise<RunTrace[]>" />

<MemberMeta badges="async" sourceHref="/source/src/store/traces-ts/#L83" sourceLabel="traces.ts:83" />

_Implementation of&#x20;_[`listByRun`](/module/store/tracesrepo#listbyrun)

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

<MemberMeta badges="async" sourceHref="/source/src/store/traces-ts/#L93" sourceLabel="traces.ts:93" />

_Implementation of&#x20;_[`listByRunCheckpoint`](/module/store/tracesrepo#listbyruncheckpoint)

All traces for a run under a specific checkpoint (Todo 26), ordered by ascending seq.

**Parameters**

- `runId` (string)
- `checkpointId` (string)

**Returns**

- `Promise<`[`RunTrace`](/module/store/runtrace)`[]>`

<MemberHeading id="listbytx" depth="3" name="listByTx" sig="listByTx(txId: string): Promise<RunTrace[]>" />

<MemberMeta badges="async" sourceHref="/source/src/store/traces-ts/#L88" sourceLabel="traces.ts:88" />

_Implementation of&#x20;_[`listByTx`](/module/store/tracesrepo#listbytx)

All traces for a transaction (Todo 26), ordered by descending seq (undo-walk order).

**Parameters**

- `txId` (string)

**Returns**

- `Promise<`[`RunTrace`](/module/store/runtrace)`[]>`

<MemberHeading id="update" depth="3" name="update" sig="update(id: string, patch: PatchTrace): Promise<RunTrace | null>" />

<MemberMeta badges="async" sourceHref="/source/src/store/traces-ts/#L98" sourceLabel="traces.ts:98" />

_Implementation of&#x20;_[`update`](/module/store/tracesrepo#update)

**Parameters**

- `id` (string)
- `patch` ([PatchTrace](/module/store/patchtrace))

**Returns**

- `Promise<`[`RunTrace`](/module/store/runtrace)` | null>`
