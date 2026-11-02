---
title: InventoryShowResult
kind: interface
longname: module:cli.InventoryShowResult
---

# InventoryShowResult

<Signature
  code="interface InventoryShowResult {
	command: 'inventory show';
	hosts: Record<string, Record<string, unknown>>;
	inventory: string;
	matchedHosts: string[];
}"
/>

<SourceLink href="/source/src/cli/types-ts/#L132" label="types.ts:132" />

---

## Properties

<MemberHeading id="command" depth="3" name="command" sig="command: 'inventory show'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L133" sourceLabel="types.ts:133" />

<MemberHeading id="hosts" depth="3" name="hosts" sig="hosts: Record<string, Record<string, unknown>>" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L136" sourceLabel="types.ts:136" />

<MemberHeading id="inventory" depth="3" name="inventory" sig="inventory: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L134" sourceLabel="types.ts:134" />

<MemberHeading id="matchedhosts" depth="3" name="matchedHosts" sig="matchedHosts: string[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L135" sourceLabel="types.ts:135" />
