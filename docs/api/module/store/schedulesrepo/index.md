---
title: SchedulesRepo
kind: interface
longname: module:store.SchedulesRepo
description: Typed CRUD over the schedules table.
---

# SchedulesRepo

<Signature
  code="interface SchedulesRepo {
	create(input: CreateScheduleInput): Promise<Schedule>;
	delete(id: string): Promise<boolean>;
	get(id: string): Promise<Schedule | null>;
	list(): Promise<Schedule[]>;
	setEnabled(id: string, enabled: boolean): Promise<Schedule | null>;
	update(id: string, patch: PatchSchedule): Promise<Schedule | null>;
}"
/>

<SourceLink href="/source/src/store/types-ts/#L247" label="types.ts:247" />

Typed CRUD over the schedules table.

#### Implemented By

- [`SchedulesRepository`](/module/store/schedulesrepository)

---

## Methods

<MemberHeading id="create" depth="3" name="create" sig="create(input: CreateScheduleInput): Promise<Schedule>" />

<MemberMeta badges="async" sourceHref="/source/src/store/types-ts/#L248" sourceLabel="types.ts:248" />

**Parameters**

- `input` ([CreateScheduleInput](/module/store/createscheduleinput))

**Returns**

- `Promise<`[`Schedule`](/module/store/schedule)`>`

<MemberHeading id="delete" depth="3" name="delete" sig="delete(id: string): Promise<boolean>" />

<MemberMeta badges="async" sourceHref="/source/src/store/types-ts/#L253" sourceLabel="types.ts:253" />

**Parameters**

- `id` (string)

**Returns**

- `Promise<boolean>`

<MemberHeading id="get" depth="3" name="get" sig="get(id: string): Promise<Schedule | null>" />

<MemberMeta badges="async" sourceHref="/source/src/store/types-ts/#L249" sourceLabel="types.ts:249" />

**Parameters**

- `id` (string)

**Returns**

- `Promise<`[`Schedule`](/module/store/schedule)` | null>`

<MemberHeading id="list" depth="3" name="list" sig="list(): Promise<Schedule[]>" />

<MemberMeta badges="async" sourceHref="/source/src/store/types-ts/#L250" sourceLabel="types.ts:250" />

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

<MemberMeta badges="async" sourceHref="/source/src/store/types-ts/#L252" sourceLabel="types.ts:252" />

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

<MemberMeta badges="async" sourceHref="/source/src/store/types-ts/#L251" sourceLabel="types.ts:251" />

**Parameters**

- `id` (string)
- `patch` ([PatchSchedule](/module/store/patchschedule))

**Returns**

- `Promise<`[`Schedule`](/module/store/schedule)` | null>`
