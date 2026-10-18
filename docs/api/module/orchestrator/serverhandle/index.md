---
title: ServerHandle
kind: interface
longname: module:orchestrator.ServerHandle
description: "Handle returned by createServer(): enough to probe status and shut down."
---

# ServerHandle

<Signature
  code="interface ServerHandle {
	baseUrl: string;
	port: number;
	store?: Store;
	closeDrain(): void;
	drain(): Promise<void>;
	isDraining(): boolean;
	listRuns(): RunRecord[];
	markShuttingDown(): void;
	runStatus(id: string): RunRecord | undefined;
	schedulerStart(): Promise<void>;
	schedulerStop(): void;
}"
/>

<SourceLink href="/source/src/orchestrator/serve-ts/#L22" label="serve.ts:22" />

Handle returned by createServer(): enough to probe status and shut down.

---

## Properties

<MemberHeading id="baseurl" depth="3" name="baseUrl" sig="baseUrl: string" />

<MemberMeta badges="readonly" sourceHref="/source/src/orchestrator/serve-ts/#L23" sourceLabel="serve.ts:23" />

<MemberHeading id="port" depth="3" name="port" sig="port: number" />

<MemberMeta badges="readonly" sourceHref="/source/src/orchestrator/serve-ts/#L24" sourceLabel="serve.ts:24" />

<MemberHeading id="store" depth="3" name="store" sig="store: Store" />

<MemberMeta badges="readonly" sourceHref="/source/src/orchestrator/serve-ts/#L25" sourceLabel="serve.ts:25" />

## Methods

<MemberHeading id="closedrain" depth="3" name="closeDrain" sig="closeDrain(): void" />

<MemberMeta sourceHref="/source/src/orchestrator/serve-ts/#L34" sourceLabel="serve.ts:34" />

Stop HTTP listener + remove any listeners. Safe to call twice.

**Returns**

- `void`

<MemberHeading id="drain" depth="3" name="drain" sig="drain(): Promise<void>" />

<MemberMeta badges="async" sourceHref="/source/src/orchestrator/serve-ts/#L30" sourceLabel="serve.ts:30" />

Resolve when all dispatched runs have settled (bounded by caller).

**Returns**

- `Promise<void>`

<MemberHeading id="isdraining" depth="3" name="isDraining" sig="isDraining(): boolean" />

<MemberMeta sourceHref="/source/src/orchestrator/serve-ts/#L27" sourceLabel="serve.ts:27" />

True once a graceful-drain sequence has begun.

**Returns**

- `boolean`

<MemberHeading id="listruns" depth="3" name="listRuns" sig="listRuns(): RunRecord[]" />

<MemberMeta sourceHref="/source/src/orchestrator/serve-ts/#L36" sourceLabel="serve.ts:36" />

**Returns**

- [`RunRecord`](/module/orchestrator/runrecord)`[]`

<MemberHeading id="markshuttingdown" depth="3" name="markShuttingDown" sig="markShuttingDown(): void" />

<MemberMeta sourceHref="/source/src/orchestrator/serve-ts/#L28" sourceLabel="serve.ts:28" />

**Returns**

- `void`

<MemberHeading id="runstatus" depth="3" name="runStatus" sig="runStatus(id: string): RunRecord | undefined" />

<MemberMeta sourceHref="/source/src/orchestrator/serve-ts/#L35" sourceLabel="serve.ts:35" />

**Parameters**

- `id` (string)

**Returns**

- [`RunRecord`](/module/orchestrator/runrecord)` | undefined`

<MemberHeading id="schedulerstart" depth="3" name="schedulerStart" sig="schedulerStart(): Promise<void>" />

<MemberMeta badges="async" sourceHref="/source/src/orchestrator/serve-ts/#L31" sourceLabel="serve.ts:31" />

**Returns**

- `Promise<void>`

<MemberHeading id="schedulerstop" depth="3" name="schedulerStop" sig="schedulerStop(): void" />

<MemberMeta sourceHref="/source/src/orchestrator/serve-ts/#L32" sourceLabel="serve.ts:32" />

**Returns**

- `void`
