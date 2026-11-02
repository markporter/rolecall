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

<SourceLink href="/source/src/cli/types-ts/#L177" label="types.ts:177" />

Result of replaying a stored run's execution-trace ledger (Todo 25).

---

## Properties

<MemberHeading id="command" depth="3" name="command" sig="command: 'run replay'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L178" sourceLabel="types.ts:178" />

<MemberHeading id="found" depth="3" name="found" sig="found: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L180" sourceLabel="types.ts:180" />

<MemberHeading id="note" depth="3" name="note" sig="note: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L184" sourceLabel="types.ts:184" />

<MemberHeading id="profile" depth="3" name="profile" sig="profile: Record<string, { failed: number; tasks: number; totalMs: number }>" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L183" sourceLabel="types.ts:183" />

Per-host wall-clock aggregation (sum of end-trace duration_ms).

<MemberHeading id="runid" depth="3" name="runId" sig="runId: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L179" sourceLabel="types.ts:179" />

<MemberHeading id="traces" depth="3" name="traces" sig="traces: RunTrace[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L181" sourceLabel="types.ts:181" />
