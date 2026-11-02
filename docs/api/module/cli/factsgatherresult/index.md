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

<SourceLink href="/source/src/cli/types-ts/#L122" label="types.ts:122" />

---

## Properties

<MemberHeading id="command" depth="3" name="command" sig="command: 'facts gather'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L123" sourceLabel="types.ts:123" />

<MemberHeading id="facts" depth="3" name="facts" sig="facts: Record<string, Record<string, unknown>>" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L127" sourceLabel="types.ts:127" />

<MemberHeading id="failures" depth="3" name="failures" sig="failures: Record<string, string>" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L128" sourceLabel="types.ts:128" />

<MemberHeading id="inventory" depth="3" name="inventory" sig="inventory: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L124" sourceLabel="types.ts:124" />

<MemberHeading id="limit" depth="3" name="limit" sig="limit: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L125" sourceLabel="types.ts:125" />

<MemberHeading id="note" depth="3" name="note" sig="note: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L129" sourceLabel="types.ts:129" />

<MemberHeading id="resolvedhosts" depth="3" name="resolvedHosts" sig="resolvedHosts: string[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L126" sourceLabel="types.ts:126" />
