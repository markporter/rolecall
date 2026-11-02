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

<SourceLink href="/source/src/cli/types-ts/#L104" label="types.ts:104" />

---

## Properties

<MemberHeading id="command" depth="3" name="command" sig="command: 'facts gather'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L105" sourceLabel="types.ts:105" />

<MemberHeading id="facts" depth="3" name="facts" sig="facts: Record<string, Record<string, unknown>>" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L109" sourceLabel="types.ts:109" />

<MemberHeading id="failures" depth="3" name="failures" sig="failures: Record<string, string>" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L110" sourceLabel="types.ts:110" />

<MemberHeading id="inventory" depth="3" name="inventory" sig="inventory: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L106" sourceLabel="types.ts:106" />

<MemberHeading id="limit" depth="3" name="limit" sig="limit: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L107" sourceLabel="types.ts:107" />

<MemberHeading id="note" depth="3" name="note" sig="note: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L111" sourceLabel="types.ts:111" />

<MemberHeading id="resolvedhosts" depth="3" name="resolvedHosts" sig="resolvedHosts: string[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L108" sourceLabel="types.ts:108" />
