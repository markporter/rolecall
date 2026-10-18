---
title: NormalizedInventory
kind: interface
longname: module:config.NormalizedInventory
---

# NormalizedInventory

<Signature
  code="interface NormalizedInventory {
	groups: Record<string, { children?: string[]; hosts: string[]; vars: Record<string, unknown> }>;
	hostVars?: Record<string, Record<string, unknown>>;
}"
/>

<SourceLink href="/source/src/config/schema-ts/#L385" label="schema.ts:385" />

---

## Properties

<MemberHeading id="groups" depth="3" name="groups" sig="groups: Record<string, { children?: string[]; hosts: string[]; vars: Record<string, unknown> }>" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L386" sourceLabel="schema.ts:386" />

<MemberHeading id="hostvars" depth="3" name="hostVars" sig="hostVars: Record<string, Record<string, unknown>>" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L391" sourceLabel="schema.ts:391" />

Per-host var maps (highest precedence layer), keyed by hostname. Absent when the source declares none.
