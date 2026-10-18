---
title: SchedulerApi
kind: interface
longname: module:orchestrator.SchedulerApi
description: Minimal scheduler hook invoked by schedule-management endpoints.
---

# SchedulerApi

<Signature
  code="interface SchedulerApi {
	trigger(params: Record<string, unknown>): Promise<boolean>;
}"
/>

<SourceLink href="/source/src/orchestrator/types-ts/#L105" label="types.ts:105" />

Minimal scheduler hook invoked by schedule-management endpoints.

#### Implemented By

- [`CronScheduler`](/module/orchestrator/cronscheduler)

---

## Methods

<MemberHeading id="trigger" depth="3" name="trigger" sig="trigger(params: Record<string, unknown>): Promise<boolean>" />

<MemberMeta badges="async" sourceHref="/source/src/orchestrator/types-ts/#L107" sourceLabel="types.ts:107" />

Trigger a scheduled job now; returns true if dispatched.

**Parameters**

- `params` (Record\<string, unknown>)

**Returns**

- `Promise<boolean>`
