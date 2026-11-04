---
title: VarsTraceResult
kind: interface
longname: module:cli.VarsTraceResult
---

# VarsTraceResult

<Signature
  code="interface VarsTraceResult {
	command: 'vars trace';
	plays: { hosts: Record<string, Record<string, VarResolution>>; name?: string }[];
}"
/>

<SourceLink href="/source/src/cli/types-ts/#L246" label="types.ts:246" />

---

## Properties

<MemberHeading id="command" depth="3" name="command" sig="command: 'vars trace'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L247" sourceLabel="types.ts:247" />

<MemberHeading id="plays" depth="3" name="plays" sig="plays: { hosts: Record<string, Record<string, VarResolution>>; name?: string }[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L249" sourceLabel="types.ts:249" />

Per-play resolution: each host maps to var name → resolution (winning value + override chain).
