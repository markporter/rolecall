---
title: RunsRepository
kind: class
longname: module:store.RunsRepository
description: Typed CRUD over the runs table.
---

# RunsRepository

<SourceLink href="/source/src/store/runs-ts/#L29" label="runs.ts:29" />

Typed CRUD over the runs table.

---

## Constructors

<MemberHeading
  id="constructor"
  depth="3"
  name="constructor"
  sig="new RunsRepository(
	db: SqliteDb,
	writes: WriteQueue,
): RunsRepository"
/>

**Parameters**

- `db` (SqliteDb) — Runtime-selected synchronous sqlite connection shared with every repository.
- `writes` ([WriteQueue](/module/store/writequeue)) — Shared single-writer serialization queue owned by StoreImpl.

**Returns**

`RunsRepository`

#### Implements

- [`RunsRepo`](/module/store/runsrepo)

---

## Methods

<MemberHeading id="create" depth="3" name="create" sig="create(input: CreateRunInput): Promise<Run>" />

<MemberMeta badges="async" sourceHref="/source/src/store/runs-ts/#L39" sourceLabel="runs.ts:39" />

_Implementation of&#x20;_[`create`](/module/store/runsrepo#create)

**Parameters**

- `input` ([CreateRunInput](/module/store/createruninput))

**Returns**

- `Promise<`[`Run`](/module/store/run)`>`

<MemberHeading id="delete" depth="3" name="delete" sig="delete(id: string): Promise<boolean>" />

<MemberMeta badges="async" sourceHref="/source/src/store/runs-ts/#L95" sourceLabel="runs.ts:95" />

_Implementation of&#x20;_[`delete`](/module/store/runsrepo#delete)

**Parameters**

- `id` (string)

**Returns**

- `Promise<boolean>`

<MemberHeading id="get" depth="3" name="get" sig="get(id: string): Promise<Run | null>" />

<MemberMeta badges="async" sourceHref="/source/src/store/runs-ts/#L63" sourceLabel="runs.ts:63" />

_Implementation of&#x20;_[`get`](/module/store/runsrepo#get)

**Parameters**

- `id` (string)

**Returns**

- `Promise<`[`Run`](/module/store/run)` | null>`

<MemberHeading id="list" depth="3" name="list" sig="list(projectId?: string): Promise<Run[]>" />

<MemberMeta badges="async" sourceHref="/source/src/store/runs-ts/#L68" sourceLabel="runs.ts:68" />

_Implementation of&#x20;_[`list`](/module/store/runsrepo#list)

**Parameters**

- `projectId` (string, optional)

**Returns**

- `Promise<`[`Run`](/module/store/run)`[]>`

<MemberHeading id="update" depth="3" name="update" sig="update(id: string, patch: PatchRun): Promise<Run | null>" />

<MemberMeta badges="async" sourceHref="/source/src/store/runs-ts/#L77" sourceLabel="runs.ts:77" />

_Implementation of&#x20;_[`update`](/module/store/runsrepo#update)

**Parameters**

- `id` (string)
- `patch` ([PatchRun](/module/store/patchrun))

**Returns**

- `Promise<`[`Run`](/module/store/run)` | null>`
