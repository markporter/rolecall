---
title: CreateScheduleInput
kind: interface
longname: module:store.CreateScheduleInput
description: Input for creating a schedule.
---

# CreateScheduleInput

<Signature
  code="interface CreateScheduleInput {
	actionType: string;
	cronSpec: string;
	enabled?: boolean;
	lastRunAt?: number;
	name: string;
	nextRunAt?: number;
	params?: Record<string, unknown>;
}"
/>

<SourceLink href="/source/src/store/types-ts/#L193" label="types.ts:193" />

Input for creating a schedule.

---

## Properties

<MemberHeading id="actiontype" depth="3" name="actionType" sig="actionType: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L196" sourceLabel="types.ts:196" />

<MemberHeading id="cronspec" depth="3" name="cronSpec" sig="cronSpec: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L195" sourceLabel="types.ts:195" />

<MemberHeading id="enabled" depth="3" name="enabled" sig="enabled: boolean" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L198" sourceLabel="types.ts:198" />

<MemberHeading id="lastrunat" depth="3" name="lastRunAt" sig="lastRunAt: number" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L200" sourceLabel="types.ts:200" />

<MemberHeading id="name" depth="3" name="name" sig="name: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L194" sourceLabel="types.ts:194" />

<MemberHeading id="nextrunat" depth="3" name="nextRunAt" sig="nextRunAt: number" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L199" sourceLabel="types.ts:199" />

<MemberHeading id="params" depth="3" name="params" sig="params: Record<string, unknown>" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L197" sourceLabel="types.ts:197" />
