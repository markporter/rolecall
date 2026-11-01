---
title: RunReplayResult
kind: interface
longname: module:cli.RunReplayResult
description: Result of replaying a stored run's execution-trace ledger (Todo 25).
---

# RunReplayResult

<Signature
  code="interface RunReplayResult {
	command: 'run replay';
	found: boolean;
	note?: string;
	profile: Record<string, { failed: number; tasks: number; totalMs: number }>;
	runId: string;
	traces: RunTrace[];
}"
/>

<SourceLink href="/source/src/cli/types-ts/#L149" label="types.ts:149" />

Result of replaying a stored run's execution-trace ledger (Todo 25).

---

## Properties

<MemberHeading id="command" depth="3" name="command" sig="command: 'run replay'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L150" sourceLabel="types.ts:150" />

<MemberHeading id="found" depth="3" name="found" sig="found: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L152" sourceLabel="types.ts:152" />

<MemberHeading id="note" depth="3" name="note" sig="note: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L156" sourceLabel="types.ts:156" />

<MemberHeading id="profile" depth="3" name="profile" sig="profile: Record<string, { failed: number; tasks: number; totalMs: number }>" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L155" sourceLabel="types.ts:155" />

Per-host wall-clock aggregation (sum of end-trace duration_ms).

<MemberHeading id="runid" depth="3" name="runId" sig="runId: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L151" sourceLabel="types.ts:151" />

<MemberHeading id="traces" depth="3" name="traces" sig="traces: RunTrace[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L153" sourceLabel="types.ts:153" />
