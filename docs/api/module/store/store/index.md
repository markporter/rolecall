---
title: Store
kind: interface
longname: module:store.Store
description: Handle returned by openStore(); owns the DB connection + write serializer, exposing entity CRUD as typed sub-collections (projects/runs/schedules).
---

# Store

<Signature
  code="interface Store {
	dbPath?: string;
	projects: ProjectsRepo;
	runs: RunsRepo;
	schedules: SchedulesRepo;
	traces: TracesRepo;
	close(): void;
}"
/>

<SourceLink href="/source/src/store/types-ts/#L257" label="types.ts:257" />

Handle returned by openStore(); owns the DB connection + write serializer, exposing entity CRUD as typed sub-collections (projects/runs/schedules).

---

## Properties

<MemberHeading id="dbpath" depth="3" name="dbPath" sig="dbPath: string" />

<MemberMeta badges="readonly" sourceHref="/source/src/store/types-ts/#L262" sourceLabel="types.ts:262" />

Absolute path of the backing sqlite file this store resolves to. Always defined for the default SQLite backend; undefined for later non-file backends.

<MemberHeading id="projects" depth="3" name="projects" sig="projects: ProjectsRepo" />

<MemberMeta badges="readonly" sourceHref="/source/src/store/types-ts/#L263" sourceLabel="types.ts:263" />

<MemberHeading id="runs" depth="3" name="runs" sig="runs: RunsRepo" />

<MemberMeta badges="readonly" sourceHref="/source/src/store/types-ts/#L264" sourceLabel="types.ts:264" />

<MemberHeading id="schedules" depth="3" name="schedules" sig="schedules: SchedulesRepo" />

<MemberMeta badges="readonly" sourceHref="/source/src/store/types-ts/#L265" sourceLabel="types.ts:265" />

<MemberHeading id="traces" depth="3" name="traces" sig="traces: TracesRepo" />

<MemberMeta badges="readonly" sourceHref="/source/src/store/types-ts/#L267" sourceLabel="types.ts:267" />

Execution-trace ledger (Todo 25): per-task/per-iteration timing + outcome.

## Methods

<MemberHeading id="close" depth="3" name="close" sig="close(): void" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L268" sourceLabel="types.ts:268" />

**Returns**

- `void`
