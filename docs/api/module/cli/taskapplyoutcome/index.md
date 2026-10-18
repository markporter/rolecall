---
title: TaskApplyOutcome
kind: interface
longname: module:cli.TaskApplyOutcome
---

# TaskApplyOutcome

<Signature
  code="interface TaskApplyOutcome {
	changed: boolean;
	failed: boolean;
	host: string;
	iterationData?: (Record<string, unknown> | undefined)[];
	iterations?: number;
	module: string;
	msg?: string;
	skipped: boolean;
	task: string;
}"
/>

<SourceLink href="/source/src/cli/types-ts/#L49" label="types.ts:49" />

---

## Properties

<MemberHeading id="changed" depth="3" name="changed" sig="changed: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L53" sourceLabel="types.ts:53" />

<MemberHeading id="failed" depth="3" name="failed" sig="failed: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L54" sourceLabel="types.ts:54" />

<MemberHeading id="host" depth="3" name="host" sig="host: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L50" sourceLabel="types.ts:50" />

<MemberHeading id="iterationdata" depth="3" name="iterationData" sig="iterationData: (Record<string, unknown> | undefined)[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L58" sourceLabel="types.ts:58" />

Per-iteration module `data` (e.g. `{ idempotent: true }` for no-op applies); surface for idempotency visibility without a new status.

<MemberHeading id="iterations" depth="3" name="iterations" sig="iterations: number" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L56" sourceLabel="types.ts:56" />

<MemberHeading id="module" depth="3" name="module" sig="module: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L52" sourceLabel="types.ts:52" />

<MemberHeading id="msg" depth="3" name="msg" sig="msg: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L59" sourceLabel="types.ts:59" />

<MemberHeading id="skipped" depth="3" name="skipped" sig="skipped: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L55" sourceLabel="types.ts:55" />

<MemberHeading id="task" depth="3" name="task" sig="task: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L51" sourceLabel="types.ts:51" />
