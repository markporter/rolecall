---
title: SchedulesRepository
kind: class
longname: module:store.SchedulesRepository
description: Typed CRUD over the schedules table.
---

# SchedulesRepository

<SourceLink href="/source/src/store/schedules-ts/#L28" label="schedules.ts:28" />

Typed CRUD over the schedules table.

---

## Constructors

<MemberHeading
  id="constructor"
  depth="3"
  name="constructor"
  sig="new SchedulesRepository(
	db: SqliteDb,
	writes: WriteQueue,
): SchedulesRepository"
/>

**Parameters**

- `db` (SqliteDb) — Runtime-selected synchronous sqlite connection shared with every repository.
- `writes` ([WriteQueue](/module/store/writequeue)) — Shared single-writer serialization queue owned by StoreImpl.

**Returns**

`SchedulesRepository`

#### Implements

- [`SchedulesRepo`](/module/store/schedulesrepo)

---

## Methods

<MemberHeading id="create" depth="3" name="create" sig="create(input: CreateScheduleInput): Promise<Schedule>" />

<MemberMeta badges="async" sourceHref="/source/src/store/schedules-ts/#L38" sourceLabel="schedules.ts:38" />

_Implementation of&#x20;_[`create`](/module/store/schedulesrepo#create)

**Parameters**

- `input` ([CreateScheduleInput](/module/store/createscheduleinput))

**Returns**

- `Promise<`[`Schedule`](/module/store/schedule)`>`

<MemberHeading id="delete" depth="3" name="delete" sig="delete(id: string): Promise<boolean>" />

<MemberMeta badges="async" sourceHref="/source/src/store/schedules-ts/#L100" sourceLabel="schedules.ts:100" />

_Implementation of&#x20;_[`delete`](/module/store/schedulesrepo#delete)

**Parameters**

- `id` (string)

**Returns**

- `Promise<boolean>`

<MemberHeading id="get" depth="3" name="get" sig="get(id: string): Promise<Schedule | null>" />

<MemberMeta badges="async" sourceHref="/source/src/store/schedules-ts/#L60" sourceLabel="schedules.ts:60" />

_Implementation of&#x20;_[`get`](/module/store/schedulesrepo#get)

**Parameters**

- `id` (string)

**Returns**

- `Promise<`[`Schedule`](/module/store/schedule)` | null>`

<MemberHeading id="list" depth="3" name="list" sig="list(): Promise<Schedule[]>" />

<MemberMeta badges="async" sourceHref="/source/src/store/schedules-ts/#L65" sourceLabel="schedules.ts:65" />

_Implementation of&#x20;_[`list`](/module/store/schedulesrepo#list)

**Returns**

- `Promise<`[`Schedule`](/module/store/schedule)`[]>`

<MemberHeading
  id="setenabled"
  depth="3"
  name="setEnabled"
  sig="setEnabled(
	id: string,
	enabled: boolean,
): Promise<Schedule | null>"
/>

<MemberMeta badges="async" sourceHref="/source/src/store/schedules-ts/#L96" sourceLabel="schedules.ts:96" />

_Implementation of&#x20;_[`setEnabled`](/module/store/schedulesrepo#setenabled)

**Parameters**

- `id` (string)
- `enabled` (boolean)

**Returns**

- `Promise<`[`Schedule`](/module/store/schedule)` | null>`

<MemberHeading
  id="update"
  depth="3"
  name="update"
  sig="update(
	id: string,
	patch: PatchSchedule,
): Promise<Schedule | null>"
/>

<MemberMeta badges="async" sourceHref="/source/src/store/schedules-ts/#L70" sourceLabel="schedules.ts:70" />

_Implementation of&#x20;_[`update`](/module/store/schedulesrepo#update)

**Parameters**

- `id` (string)
- `patch` ([PatchSchedule](/module/store/patchschedule))

**Returns**

- `Promise<`[`Schedule`](/module/store/schedule)` | null>`
