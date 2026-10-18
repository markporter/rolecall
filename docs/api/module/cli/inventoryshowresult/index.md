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

<SourceLink href="/source/src/cli/types-ts/#L104" label="types.ts:104" />

---

## Properties

<MemberHeading id="command" depth="3" name="command" sig="command: 'inventory show'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L105" sourceLabel="types.ts:105" />

<MemberHeading id="hosts" depth="3" name="hosts" sig="hosts: Record<string, Record<string, unknown>>" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L108" sourceLabel="types.ts:108" />

<MemberHeading id="inventory" depth="3" name="inventory" sig="inventory: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L106" sourceLabel="types.ts:106" />

<MemberHeading id="matchedhosts" depth="3" name="matchedHosts" sig="matchedHosts: string[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L107" sourceLabel="types.ts:107" />
