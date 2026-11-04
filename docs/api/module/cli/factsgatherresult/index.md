---
title: FactsGatherResult
kind: interface
longname: module:cli.FactsGatherResult
---

# FactsGatherResult

<Signature
  code="interface FactsGatherResult {
	command: 'facts gather';
	facts: Record<string, Record<string, unknown>>;
	failures: Record<string, string>;
	inventory: string;
	limit?: string;
	note: string;
	resolvedHosts: string[];
}"
/>

<SourceLink href="/source/src/cli/types-ts/#L142" label="types.ts:142" />

---

## Properties

<MemberHeading id="command" depth="3" name="command" sig="command: 'facts gather'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L143" sourceLabel="types.ts:143" />

<MemberHeading id="facts" depth="3" name="facts" sig="facts: Record<string, Record<string, unknown>>" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L147" sourceLabel="types.ts:147" />

<MemberHeading id="failures" depth="3" name="failures" sig="failures: Record<string, string>" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L148" sourceLabel="types.ts:148" />

<MemberHeading id="inventory" depth="3" name="inventory" sig="inventory: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L144" sourceLabel="types.ts:144" />

<MemberHeading id="limit" depth="3" name="limit" sig="limit: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L145" sourceLabel="types.ts:145" />

<MemberHeading id="note" depth="3" name="note" sig="note: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L149" sourceLabel="types.ts:149" />

<MemberHeading id="resolvedhosts" depth="3" name="resolvedHosts" sig="resolvedHosts: string[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L146" sourceLabel="types.ts:146" />
