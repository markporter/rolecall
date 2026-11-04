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

<SourceLink href="/source/src/cli/types-ts/#L150" label="types.ts:150" />

---

## Properties

<MemberHeading id="command" depth="3" name="command" sig="command: 'inventory show'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L151" sourceLabel="types.ts:151" />

<MemberHeading id="hosts" depth="3" name="hosts" sig="hosts: Record<string, Record<string, unknown>>" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L154" sourceLabel="types.ts:154" />

<MemberHeading id="inventory" depth="3" name="inventory" sig="inventory: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L152" sourceLabel="types.ts:152" />

<MemberHeading id="matchedhosts" depth="3" name="matchedHosts" sig="matchedHosts: string[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L153" sourceLabel="types.ts:153" />
