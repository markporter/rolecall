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

<SourceLink href="/source/src/cli/types-ts/#L110" label="types.ts:110" />

---

## Properties

<MemberHeading id="command" depth="3" name="command" sig="command: 'inventory show'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L111" sourceLabel="types.ts:111" />

<MemberHeading id="hosts" depth="3" name="hosts" sig="hosts: Record<string, Record<string, unknown>>" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L114" sourceLabel="types.ts:114" />

<MemberHeading id="inventory" depth="3" name="inventory" sig="inventory: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L112" sourceLabel="types.ts:112" />

<MemberHeading id="matchedhosts" depth="3" name="matchedHosts" sig="matchedHosts: string[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L113" sourceLabel="types.ts:113" />
