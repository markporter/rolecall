---
title: Engine
kind: class
longname: module:orchestrator.Engine
---

# Engine

<SourceLink href="/source/src/orchestrator/engine-ts/#L19" label="engine.ts:19" />

---

## Constructors

<MemberHeading
  id="constructor"
  depth="3"
  name="constructor"
  sig="new Engine(
	store?: Store,
	fleet?: TargetDescriptor[],
	scheduler?: SchedulerApi,
	opts?: ServerOptions,
): Engine"
/>

**Parameters**

- `store` ([Store](/module/store/store), optional)
- `fleet` ([TargetDescriptor](/module/orchestrator/targetdescriptor)\[], optional)
- `scheduler` ([SchedulerApi](/module/orchestrator/schedulerapi), optional)
- `opts` ([ServerOptions](/module/orchestrator/serveroptions), optional)

**Returns**

`Engine`

---

## Methods

<MemberHeading id="active" depth="3" name="active" sig="active(): number" />

<MemberMeta sourceHref="/source/src/orchestrator/engine-ts/#L46" sourceLabel="engine.ts:46" />

Number of runs currently executing (for status/drain bookkeeping).

**Returns**

- `number`

<MemberHeading id="enqueue" depth="3" name="enqueue" sig="enqueue(body: JobBody): string" />

<MemberMeta sourceHref="/source/src/orchestrator/engine-ts/#L60" sourceLabel="engine.ts:60" />

**Parameters**

- `body` ([JobBody](/module/orchestrator/jobbody))

**Returns**

- `string`

<MemberHeading id="get" depth="3" name="get" sig="get(id: string): RunRecord | undefined" />

<MemberMeta sourceHref="/source/src/orchestrator/engine-ts/#L50" sourceLabel="engine.ts:50" />

**Parameters**

- `id` (string)

**Returns**

- [`RunRecord`](/module/orchestrator/runrecord)` | undefined`

<MemberHeading id="isdraining" depth="3" name="isDraining" sig="isDraining(): boolean" />

<MemberMeta sourceHref="/source/src/orchestrator/engine-ts/#L39" sourceLabel="engine.ts:39" />

**Returns**

- `boolean`

<MemberHeading id="list" depth="3" name="list" sig="list(): RunRecord[]" />

<MemberMeta sourceHref="/source/src/orchestrator/engine-ts/#L54" sourceLabel="engine.ts:54" />

**Returns**

- [`RunRecord`](/module/orchestrator/runrecord)`[]`

<MemberHeading id="registerfleet" depth="3" name="registerFleet" sig="registerFleet(targets: TargetDescriptor[]): void" />

<MemberMeta sourceHref="/source/src/orchestrator/engine-ts/#L41" sourceLabel="engine.ts:41" />

**Parameters**

- `targets` ([TargetDescriptor](/module/orchestrator/targetdescriptor)\[])

**Returns**

- `void`

<MemberHeading id="setdraining" depth="3" name="setDraining" sig="setDraining(v: boolean): void" />

<MemberMeta sourceHref="/source/src/orchestrator/engine-ts/#L38" sourceLabel="engine.ts:38" />

Drain flag: once true, new runs are rejected (set during graceful shutdown).

**Parameters**

- `v` (boolean)

**Returns**

- `void`
