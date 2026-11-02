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

<SourceLink href="/source/src/cli/types-ts/#L77" label="types.ts:77" />

---

## Properties

<MemberHeading id="changed" depth="3" name="changed" sig="changed: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L81" sourceLabel="types.ts:81" />

<MemberHeading id="failed" depth="3" name="failed" sig="failed: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L82" sourceLabel="types.ts:82" />

<MemberHeading id="host" depth="3" name="host" sig="host: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L78" sourceLabel="types.ts:78" />

<MemberHeading id="iterationdata" depth="3" name="iterationData" sig="iterationData: (Record<string, unknown> | undefined)[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L86" sourceLabel="types.ts:86" />

Per-iteration module `data` (e.g. `{ idempotent: true }` for no-op applies); surface for idempotency visibility without a new status.

<MemberHeading id="iterations" depth="3" name="iterations" sig="iterations: number" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L84" sourceLabel="types.ts:84" />

<MemberHeading id="module" depth="3" name="module" sig="module: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L80" sourceLabel="types.ts:80" />

<MemberHeading id="msg" depth="3" name="msg" sig="msg: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L87" sourceLabel="types.ts:87" />

<MemberHeading id="skipped" depth="3" name="skipped" sig="skipped: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L83" sourceLabel="types.ts:83" />

<MemberHeading id="task" depth="3" name="task" sig="task: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L79" sourceLabel="types.ts:79" />
