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

<SourceLink href="/source/src/cli/types-ts/#L244" label="types.ts:244" />

---

## Properties

<MemberHeading id="command" depth="3" name="command" sig="command: 'vars trace'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L245" sourceLabel="types.ts:245" />

<MemberHeading id="plays" depth="3" name="plays" sig="plays: { hosts: Record<string, Record<string, VarResolution>>; name?: string }[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L247" sourceLabel="types.ts:247" />

Per-play resolution: each host maps to var name → resolution (winning value + override chain).
