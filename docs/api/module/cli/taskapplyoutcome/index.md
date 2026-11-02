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

<SourceLink href="/source/src/cli/types-ts/#L59" label="types.ts:59" />

---

## Properties

<MemberHeading id="changed" depth="3" name="changed" sig="changed: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L63" sourceLabel="types.ts:63" />

<MemberHeading id="failed" depth="3" name="failed" sig="failed: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L64" sourceLabel="types.ts:64" />

<MemberHeading id="host" depth="3" name="host" sig="host: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L60" sourceLabel="types.ts:60" />

<MemberHeading id="iterationdata" depth="3" name="iterationData" sig="iterationData: (Record<string, unknown> | undefined)[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L68" sourceLabel="types.ts:68" />

Per-iteration module `data` (e.g. `{ idempotent: true }` for no-op applies); surface for idempotency visibility without a new status.

<MemberHeading id="iterations" depth="3" name="iterations" sig="iterations: number" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L66" sourceLabel="types.ts:66" />

<MemberHeading id="module" depth="3" name="module" sig="module: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L62" sourceLabel="types.ts:62" />

<MemberHeading id="msg" depth="3" name="msg" sig="msg: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L69" sourceLabel="types.ts:69" />

<MemberHeading id="skipped" depth="3" name="skipped" sig="skipped: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L65" sourceLabel="types.ts:65" />

<MemberHeading id="task" depth="3" name="task" sig="task: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L61" sourceLabel="types.ts:61" />
