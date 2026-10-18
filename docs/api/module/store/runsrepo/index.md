---
title: RunsRepo
kind: interface
longname: module:store.RunsRepo
description: Typed CRUD over the runs table.
---

# RunsRepo

<Signature
  code="interface RunsRepo {
	create(input: CreateRunInput): Promise<Run>;
	delete(id: string): Promise<boolean>;
	get(id: string): Promise<Run | null>;
	list(projectId?: string): Promise<Run[]>;
	update(id: string, patch: PatchRun): Promise<Run | null>;
}"
/>

<SourceLink href="/source/src/store/types-ts/#L224" label="types.ts:224" />

Typed CRUD over the runs table.

#### Implemented By

- [`RunsRepository`](/module/store/runsrepository)

---

## Methods

<MemberHeading id="create" depth="3" name="create" sig="create(input: CreateRunInput): Promise<Run>" />

<MemberMeta badges="async" sourceHref="/source/src/store/types-ts/#L225" sourceLabel="types.ts:225" />

**Parameters**

- `input` ([CreateRunInput](/module/store/createruninput))

**Returns**

- `Promise<`[`Run`](/module/store/run)`>`

<MemberHeading id="delete" depth="3" name="delete" sig="delete(id: string): Promise<boolean>" />

<MemberMeta badges="async" sourceHref="/source/src/store/types-ts/#L229" sourceLabel="types.ts:229" />

**Parameters**

- `id` (string)

**Returns**

- `Promise<boolean>`

<MemberHeading id="get" depth="3" name="get" sig="get(id: string): Promise<Run | null>" />

<MemberMeta badges="async" sourceHref="/source/src/store/types-ts/#L226" sourceLabel="types.ts:226" />

**Parameters**

- `id` (string)

**Returns**

- `Promise<`[`Run`](/module/store/run)` | null>`

<MemberHeading id="list" depth="3" name="list" sig="list(projectId?: string): Promise<Run[]>" />

<MemberMeta badges="async" sourceHref="/source/src/store/types-ts/#L227" sourceLabel="types.ts:227" />

**Parameters**

- `projectId` (string, optional)

**Returns**

- `Promise<`[`Run`](/module/store/run)`[]>`

<MemberHeading id="update" depth="3" name="update" sig="update(id: string, patch: PatchRun): Promise<Run | null>" />

<MemberMeta badges="async" sourceHref="/source/src/store/types-ts/#L228" sourceLabel="types.ts:228" />

**Parameters**

- `id` (string)
- `patch` ([PatchRun](/module/store/patchrun))

**Returns**

- `Promise<`[`Run`](/module/store/run)` | null>`
