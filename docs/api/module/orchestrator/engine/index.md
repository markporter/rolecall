---
title: Engine
kind: class
longname: module:orchestrator.Engine
---

# Engine

<SourceLink href="/source/src/orchestrator/engine-ts/#L37" label="engine.ts:37" />

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
	_opts?: ServerOptions,
): Engine"
/>

**Parameters**

- `store` ([Store](/module/store/store), optional)
- `fleet` ([TargetDescriptor](/module/orchestrator/targetdescriptor)\[], optional)
- `scheduler` ([SchedulerApi](/module/orchestrator/schedulerapi), optional)
- `_opts` ([ServerOptions](/module/orchestrator/serveroptions), optional)

**Returns**

`Engine`

---

## Methods

<MemberHeading id="active" depth="3" name="active" sig="active(): number" />

<MemberMeta sourceHref="/source/src/orchestrator/engine-ts/#L60" sourceLabel="engine.ts:60" />

Number of runs currently executing (for status/drain bookkeeping).

**Returns**

- `number`

<MemberHeading id="enqueue" depth="3" name="enqueue" sig="enqueue(body: JobBody): string" />

<MemberMeta sourceHref="/source/src/orchestrator/engine-ts/#L74" sourceLabel="engine.ts:74" />

**Parameters**

- `body` ([JobBody](/module/orchestrator/jobbody))

**Returns**

- `string`

<MemberHeading id="get" depth="3" name="get" sig="get(id: string): RunRecord | undefined" />

<MemberMeta sourceHref="/source/src/orchestrator/engine-ts/#L64" sourceLabel="engine.ts:64" />

**Parameters**

- `id` (string)

**Returns**

- [`RunRecord`](/module/orchestrator/runrecord)` | undefined`

<MemberHeading id="isdraining" depth="3" name="isDraining" sig="isDraining(): boolean" />

<MemberMeta sourceHref="/source/src/orchestrator/engine-ts/#L53" sourceLabel="engine.ts:53" />

**Returns**

- `boolean`

<MemberHeading id="list" depth="3" name="list" sig="list(): RunRecord[]" />

<MemberMeta sourceHref="/source/src/orchestrator/engine-ts/#L68" sourceLabel="engine.ts:68" />

**Returns**

- [`RunRecord`](/module/orchestrator/runrecord)`[]`

<MemberHeading id="registerfleet" depth="3" name="registerFleet" sig="registerFleet(targets: TargetDescriptor[]): void" />

<MemberMeta sourceHref="/source/src/orchestrator/engine-ts/#L55" sourceLabel="engine.ts:55" />

**Parameters**

- `targets` ([TargetDescriptor](/module/orchestrator/targetdescriptor)\[])

**Returns**

- `void`

<MemberHeading id="setdraining" depth="3" name="setDraining" sig="setDraining(v: boolean): void" />

<MemberMeta sourceHref="/source/src/orchestrator/engine-ts/#L52" sourceLabel="engine.ts:52" />

Drain flag: once true, new runs are rejected (set during graceful shutdown).

**Parameters**

- `v` (boolean)

**Returns**

- `void`
