---
title: PatchTrace
kind: interface
longname: module:store.PatchTrace
description: Partial mutation of a trace (e.g. mark a start row ended).
---

# PatchTrace

<Signature
  code="interface PatchTrace {
	detail?: Record<string, unknown>;
	durationMs?: number | null;
	endedAt?: number | null;
	status?: string;
}"
/>

<SourceLink href="/source/src/store/types-ts/#L153" label="types.ts:153" />

Partial mutation of a trace (e.g. mark a start row ended).

---

## Properties

<MemberHeading id="detail" depth="3" name="detail" sig="detail: Record<string, unknown>" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L157" sourceLabel="types.ts:157" />

<MemberHeading id="durationms" depth="3" name="durationMs" sig="durationMs: number | null" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L155" sourceLabel="types.ts:155" />

<MemberHeading id="endedat" depth="3" name="endedAt" sig="endedAt: number | null" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L154" sourceLabel="types.ts:154" />

<MemberHeading id="status" depth="3" name="status" sig="status: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L156" sourceLabel="types.ts:156" />
