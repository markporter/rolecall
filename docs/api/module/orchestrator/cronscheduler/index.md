---
title: CronScheduler
kind: class
longname: module:orchestrator.CronScheduler
description: Minimal scheduler hook invoked by schedule-management endpoints.
---

# CronScheduler

<SourceLink href="/source/src/orchestrator/scheduler-ts/#L36" label="scheduler.ts:36" />

Minimal scheduler hook invoked by schedule-management endpoints.

---

## Constructors

<MemberHeading id="constructor" depth="3" name="constructor" sig="new CronScheduler(opts: CronSchedulerOptions): CronScheduler" />

**Parameters**

- `opts` ([CronSchedulerOptions](/module/orchestrator/cronscheduleroptions))

**Returns**

`CronScheduler`

#### Implements

- [`SchedulerApi`](/module/orchestrator/schedulerapi)

---

## Methods

<MemberHeading id="runonce" depth="3" name="runOnce" sig="runOnce(): Promise<void>" />

<MemberMeta badges="async" sourceHref="/source/src/orchestrator/scheduler-ts/#L71" sourceLabel="scheduler.ts:71" />

**Returns**

- `Promise<void>`

<MemberHeading id="start" depth="3" name="start" sig="start(): Promise<void>" />

<MemberMeta badges="async" sourceHref="/source/src/orchestrator/scheduler-ts/#L52" sourceLabel="scheduler.ts:52" />

**Returns**

- `Promise<void>`

<MemberHeading id="stop" depth="3" name="stop" sig="stop(): void" />

<MemberMeta sourceHref="/source/src/orchestrator/scheduler-ts/#L61" sourceLabel="scheduler.ts:61" />

**Returns**

- `void`

<MemberHeading id="trigger" depth="3" name="trigger" sig="trigger(params: Record<string, unknown>): Promise<boolean>" />

<MemberMeta badges="async" sourceHref="/source/src/orchestrator/scheduler-ts/#L76" sourceLabel="scheduler.ts:76" />

_Implementation of&#x20;_[`trigger`](/module/orchestrator/schedulerapi#trigger)

Trigger a scheduled job now; returns true if dispatched.

**Parameters**

- `params` (Record\<string, unknown>)

**Returns**

- `Promise<boolean>`
