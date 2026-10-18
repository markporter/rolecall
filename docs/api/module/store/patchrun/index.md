---
title: PatchRun
kind: interface
longname: module:store.PatchRun
description: Partial mutation of a run (e.g. mark finished / set summary).
---

# PatchRun

<Signature
  code="interface PatchRun {
	finishedAt?: number;
	resultSummary?: string;
	status?: string;
}"
/>

<SourceLink href="/source/src/store/types-ts/#L174" label="types.ts:174" />

Partial mutation of a run (e.g. mark finished / set summary).

---

## Properties

<MemberHeading id="finishedat" depth="3" name="finishedAt" sig="finishedAt: number" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L177" sourceLabel="types.ts:177" />

<MemberHeading id="resultsummary" depth="3" name="resultSummary" sig="resultSummary: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L176" sourceLabel="types.ts:176" />

<MemberHeading id="status" depth="3" name="status" sig="status: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L175" sourceLabel="types.ts:175" />
