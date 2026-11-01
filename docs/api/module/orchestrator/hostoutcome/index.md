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
	module?: string;
	ok: boolean;
	summary: string;
	task?: string;
}"
/>

<SourceLink href="/source/src/orchestrator/types-ts/#L88" label="types.ts:88" />

Per-host result of executing one action against one target.

---

## Properties

<MemberHeading id="changed" depth="3" name="changed" sig="changed: boolean" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L91" sourceLabel="types.ts:91" />

<MemberHeading id="detail" depth="3" name="detail" sig="detail: unknown" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L97" sourceLabel="types.ts:97" />

<MemberHeading id="host" depth="3" name="host" sig="host: string" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L89" sourceLabel="types.ts:89" />

<MemberHeading id="module" depth="3" name="module" sig="module: string" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L96" sourceLabel="types.ts:96" />

Module that produced this outcome, when known.

<MemberHeading id="ok" depth="3" name="ok" sig="ok: boolean" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L90" sourceLabel="types.ts:90" />

<MemberHeading id="summary" depth="3" name="summary" sig="summary: string" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L92" sourceLabel="types.ts:92" />

<MemberHeading id="task" depth="3" name="task" sig="task: string" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L94" sourceLabel="types.ts:94" />

Task name that produced this outcome, when the run executed a playbook.
