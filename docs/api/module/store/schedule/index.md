---
title: Schedule
kind: interface
longname: module:store.Schedule
description: A persisted Schedule definition (cron-driven automation).
---

# Schedule

<Signature
  code="interface Schedule {
	actionType: string;
	cronSpec: string;
	enabled: boolean;
	id: string;
	lastRunAt?: number;
	name: string;
	nextRunAt?: number;
	params: Record<string, unknown>;
}"
/>

<SourceLink href="/source/src/store/types-ts/#L181" label="types.ts:181" />

A persisted Schedule definition (cron-driven automation).

---

## Properties

<MemberHeading id="actiontype" depth="3" name="actionType" sig="actionType: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L185" sourceLabel="types.ts:185" />

<MemberHeading id="cronspec" depth="3" name="cronSpec" sig="cronSpec: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L184" sourceLabel="types.ts:184" />

<MemberHeading id="enabled" depth="3" name="enabled" sig="enabled: boolean" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L187" sourceLabel="types.ts:187" />

<MemberHeading id="id" depth="3" name="id" sig="id: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L182" sourceLabel="types.ts:182" />

<MemberHeading id="lastrunat" depth="3" name="lastRunAt" sig="lastRunAt: number" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L189" sourceLabel="types.ts:189" />

<MemberHeading id="name" depth="3" name="name" sig="name: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L183" sourceLabel="types.ts:183" />

<MemberHeading id="nextrunat" depth="3" name="nextRunAt" sig="nextRunAt: number" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L188" sourceLabel="types.ts:188" />

<MemberHeading id="params" depth="3" name="params" sig="params: Record<string, unknown>" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L186" sourceLabel="types.ts:186" />
