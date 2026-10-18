---
title: Enqueuer
kind: interface
longname: module:orchestrator.Enqueuer
description: Anything able to enqueue a job body and return its run id.
---

# Enqueuer

<Signature
  code="interface Enqueuer {
	enqueue(body: JobBody): string;
}"
/>

<SourceLink href="/source/src/orchestrator/scheduler-ts/#L26" label="scheduler.ts:26" />

Anything able to enqueue a job body and return its run id.

---

## Methods

<MemberHeading id="enqueue" depth="3" name="enqueue" sig="enqueue(body: JobBody): string" />

<MemberMeta sourceHref="/source/src/orchestrator/scheduler-ts/#L27" sourceLabel="scheduler.ts:27" />

**Parameters**

- `body` ([JobBody](/module/orchestrator/jobbody))

**Returns**

- `string`
