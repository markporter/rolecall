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

<SourceLink href="/source/src/cli/types-ts/#L206" label="types.ts:206" />

---

## Properties

<MemberHeading id="command" depth="3" name="command" sig="command: 'vars trace'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L207" sourceLabel="types.ts:207" />

<MemberHeading id="plays" depth="3" name="plays" sig="plays: { hosts: Record<string, Record<string, VarResolution>>; name?: string }[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L209" sourceLabel="types.ts:209" />

Per-play resolution: each host maps to var name → resolution (winning value + override chain).
