---
title: PatchSchedule
kind: interface
longname: module:store.PatchSchedule
description: Partial mutation of a schedule.
---

# PatchSchedule

<Signature
  code="interface PatchSchedule {
	actionType?: string;
	cronSpec?: string;
	enabled?: boolean;
	lastRunAt?: number;
	name?: string;
	nextRunAt?: number;
	params?: Record<string, unknown>;
}"
/>

<SourceLink href="/source/src/store/types-ts/#L204" label="types.ts:204" />

Partial mutation of a schedule.

---

## Properties

<MemberHeading id="actiontype" depth="3" name="actionType" sig="actionType: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L207" sourceLabel="types.ts:207" />

<MemberHeading id="cronspec" depth="3" name="cronSpec" sig="cronSpec: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L206" sourceLabel="types.ts:206" />

<MemberHeading id="enabled" depth="3" name="enabled" sig="enabled: boolean" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L209" sourceLabel="types.ts:209" />

<MemberHeading id="lastrunat" depth="3" name="lastRunAt" sig="lastRunAt: number" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L211" sourceLabel="types.ts:211" />

<MemberHeading id="name" depth="3" name="name" sig="name: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L205" sourceLabel="types.ts:205" />

<MemberHeading id="nextrunat" depth="3" name="nextRunAt" sig="nextRunAt: number" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L210" sourceLabel="types.ts:210" />

<MemberHeading id="params" depth="3" name="params" sig="params: Record<string, unknown>" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L208" sourceLabel="types.ts:208" />
