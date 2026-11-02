---
title: PlaybookRunResult
kind: interface
longname: module:cli.PlaybookRunResult
---

# PlaybookRunResult

<Signature
  code="interface PlaybookRunResult {
	check?: boolean;
	command: 'playbook run';
	flags: { check: boolean; diff: boolean; force: boolean; forks?: number; limit?: string; skipTags?: string[]; tags?: string[] };
	force?: boolean;
	inventory?: string;
	mode: 'applied' | 'dry-run';
	note: string;
	outcomes?: TaskApplyOutcome[];
	playbook: string;
	rendered?: RenderedTemplate[];
	resolvedHosts: string[];
	skeleton: { host: string; module: string; task: string }[];
	tasks: { module: string; name: string }[];
	totals?: ApplyTotals;
}"
/>

<SourceLink href="/source/src/cli/types-ts/#L105" label="types.ts:105" />

---

## Properties

<MemberHeading id="check" depth="3" name="check" sig="check: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L117" sourceLabel="types.ts:117" />

<MemberHeading id="command" depth="3" name="command" sig="command: 'playbook run'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L106" sourceLabel="types.ts:106" />

<MemberHeading id="flags" depth="3" name="flags" sig="flags: { check: boolean; diff: boolean; force: boolean; forks?: number; limit?: string; skipTags?: string[]; tags?: string[] }" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L110" sourceLabel="types.ts:110" />

**Properties**

- `check` (boolean)
- `diff` (boolean)
- `force` (boolean)
- `forks` (number, optional)
- `limit` (string, optional)
- `skipTags` (string\[], optional)
- `tags` (string\[], optional)

<MemberHeading id="force" depth="3" name="force" sig="force: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L118" sourceLabel="types.ts:118" />

<MemberHeading id="inventory" depth="3" name="inventory" sig="inventory: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L108" sourceLabel="types.ts:108" />

<MemberHeading id="mode" depth="3" name="mode" sig="mode: 'applied' | 'dry-run'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L109" sourceLabel="types.ts:109" />

<MemberHeading id="note" depth="3" name="note" sig="note: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L119" sourceLabel="types.ts:119" />

<MemberHeading id="outcomes" depth="3" name="outcomes" sig="outcomes: TaskApplyOutcome[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L115" sourceLabel="types.ts:115" />

<MemberHeading id="playbook" depth="3" name="playbook" sig="playbook: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L107" sourceLabel="types.ts:107" />

<MemberHeading id="rendered" depth="3" name="rendered" sig="rendered: RenderedTemplate[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L116" sourceLabel="types.ts:116" />

<MemberHeading id="resolvedhosts" depth="3" name="resolvedHosts" sig="resolvedHosts: string[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L111" sourceLabel="types.ts:111" />

<MemberHeading id="skeleton" depth="3" name="skeleton" sig="skeleton: { host: string; module: string; task: string }[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L113" sourceLabel="types.ts:113" />

<MemberHeading id="tasks" depth="3" name="tasks" sig="tasks: { module: string; name: string }[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L112" sourceLabel="types.ts:112" />

<MemberHeading id="totals" depth="3" name="totals" sig="totals: ApplyTotals" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L114" sourceLabel="types.ts:114" />
