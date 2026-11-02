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

<SourceLink href="/source/src/cli/types-ts/#L85" label="types.ts:85" />

---

## Properties

<MemberHeading id="changed" depth="3" name="changed" sig="changed: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L89" sourceLabel="types.ts:89" />

<MemberHeading id="failed" depth="3" name="failed" sig="failed: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L90" sourceLabel="types.ts:90" />

<MemberHeading id="host" depth="3" name="host" sig="host: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L86" sourceLabel="types.ts:86" />

<MemberHeading id="iterationdata" depth="3" name="iterationData" sig="iterationData: (Record<string, unknown> | undefined)[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L94" sourceLabel="types.ts:94" />

Per-iteration module `data` (e.g. `{ idempotent: true }` for no-op applies); surface for idempotency visibility without a new status.

<MemberHeading id="iterations" depth="3" name="iterations" sig="iterations: number" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L92" sourceLabel="types.ts:92" />

<MemberHeading id="module" depth="3" name="module" sig="module: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L88" sourceLabel="types.ts:88" />

<MemberHeading id="msg" depth="3" name="msg" sig="msg: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L95" sourceLabel="types.ts:95" />

<MemberHeading id="skipped" depth="3" name="skipped" sig="skipped: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L91" sourceLabel="types.ts:91" />

<MemberHeading id="task" depth="3" name="task" sig="task: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L87" sourceLabel="types.ts:87" />
