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

<SourceLink href="/source/src/cli/types-ts/#L234" label="types.ts:234" />

---

## Properties

<MemberHeading id="command" depth="3" name="command" sig="command: 'vars trace'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L235" sourceLabel="types.ts:235" />

<MemberHeading id="plays" depth="3" name="plays" sig="plays: { hosts: Record<string, Record<string, VarResolution>>; name?: string }[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L237" sourceLabel="types.ts:237" />

Per-play resolution: each host maps to var name → resolution (winning value + override chain).
