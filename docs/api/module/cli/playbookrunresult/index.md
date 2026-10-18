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

<SourceLink href="/source/src/cli/types-ts/#L77" label="types.ts:77" />

---

## Properties

<MemberHeading id="check" depth="3" name="check" sig="check: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L89" sourceLabel="types.ts:89" />

<MemberHeading id="command" depth="3" name="command" sig="command: 'playbook run'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L78" sourceLabel="types.ts:78" />

<MemberHeading id="flags" depth="3" name="flags" sig="flags: { check: boolean; diff: boolean; force: boolean; forks?: number; limit?: string; skipTags?: string[]; tags?: string[] }" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L82" sourceLabel="types.ts:82" />

**Properties**

- `check` (boolean)
- `diff` (boolean)
- `force` (boolean)
- `forks` (number, optional)
- `limit` (string, optional)
- `skipTags` (string\[], optional)
- `tags` (string\[], optional)

<MemberHeading id="force" depth="3" name="force" sig="force: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L90" sourceLabel="types.ts:90" />

<MemberHeading id="inventory" depth="3" name="inventory" sig="inventory: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L80" sourceLabel="types.ts:80" />

<MemberHeading id="mode" depth="3" name="mode" sig="mode: 'applied' | 'dry-run'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L81" sourceLabel="types.ts:81" />

<MemberHeading id="note" depth="3" name="note" sig="note: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L91" sourceLabel="types.ts:91" />

<MemberHeading id="outcomes" depth="3" name="outcomes" sig="outcomes: TaskApplyOutcome[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L87" sourceLabel="types.ts:87" />

<MemberHeading id="playbook" depth="3" name="playbook" sig="playbook: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L79" sourceLabel="types.ts:79" />

<MemberHeading id="rendered" depth="3" name="rendered" sig="rendered: RenderedTemplate[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L88" sourceLabel="types.ts:88" />

<MemberHeading id="resolvedhosts" depth="3" name="resolvedHosts" sig="resolvedHosts: string[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L83" sourceLabel="types.ts:83" />

<MemberHeading id="skeleton" depth="3" name="skeleton" sig="skeleton: { host: string; module: string; task: string }[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L85" sourceLabel="types.ts:85" />

<MemberHeading id="tasks" depth="3" name="tasks" sig="tasks: { module: string; name: string }[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L84" sourceLabel="types.ts:84" />

<MemberHeading id="totals" depth="3" name="totals" sig="totals: ApplyTotals" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L86" sourceLabel="types.ts:86" />
