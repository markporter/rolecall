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

<SourceLink href="/source/src/cli/types-ts/#L132" label="types.ts:132" />

---

## Properties

<MemberHeading id="command" depth="3" name="command" sig="command: 'facts gather'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L133" sourceLabel="types.ts:133" />

<MemberHeading id="facts" depth="3" name="facts" sig="facts: Record<string, Record<string, unknown>>" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L137" sourceLabel="types.ts:137" />

<MemberHeading id="failures" depth="3" name="failures" sig="failures: Record<string, string>" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L138" sourceLabel="types.ts:138" />

<MemberHeading id="inventory" depth="3" name="inventory" sig="inventory: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L134" sourceLabel="types.ts:134" />

<MemberHeading id="limit" depth="3" name="limit" sig="limit: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L135" sourceLabel="types.ts:135" />

<MemberHeading id="note" depth="3" name="note" sig="note: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L139" sourceLabel="types.ts:139" />

<MemberHeading id="resolvedhosts" depth="3" name="resolvedHosts" sig="resolvedHosts: string[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L136" sourceLabel="types.ts:136" />
