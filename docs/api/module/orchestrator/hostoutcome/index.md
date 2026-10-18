---
title: HostOutcome
kind: interface
longname: module:orchestrator.HostOutcome
description: Per-host result of executing one action against one target.
---

# HostOutcome

<Signature
  code="interface HostOutcome {
	changed: boolean;
	detail?: unknown;
	host: string;
	ok: boolean;
	summary: string;
}"
/>

<SourceLink href="/source/src/orchestrator/types-ts/#L84" label="types.ts:84" />

Per-host result of executing one action against one target.

---

## Properties

<MemberHeading id="changed" depth="3" name="changed" sig="changed: boolean" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L87" sourceLabel="types.ts:87" />

<MemberHeading id="detail" depth="3" name="detail" sig="detail: unknown" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L89" sourceLabel="types.ts:89" />

<MemberHeading id="host" depth="3" name="host" sig="host: string" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L85" sourceLabel="types.ts:85" />

<MemberHeading id="ok" depth="3" name="ok" sig="ok: boolean" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L86" sourceLabel="types.ts:86" />

<MemberHeading id="summary" depth="3" name="summary" sig="summary: string" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L88" sourceLabel="types.ts:88" />
