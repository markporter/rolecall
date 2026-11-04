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

<SourceLink href="/source/src/cli/types-ts/#L123" label="types.ts:123" />

---

## Properties

<MemberHeading id="check" depth="3" name="check" sig="check: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L135" sourceLabel="types.ts:135" />

<MemberHeading id="command" depth="3" name="command" sig="command: 'playbook run'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L124" sourceLabel="types.ts:124" />

<MemberHeading id="flags" depth="3" name="flags" sig="flags: { check: boolean; diff: boolean; force: boolean; forks?: number; limit?: string; skipTags?: string[]; tags?: string[] }" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L128" sourceLabel="types.ts:128" />

**Properties**

- `check` (boolean)
- `diff` (boolean)
- `force` (boolean)
- `forks` (number, optional)
- `limit` (string, optional)
- `skipTags` (string\[], optional)
- `tags` (string\[], optional)

<MemberHeading id="force" depth="3" name="force" sig="force: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L136" sourceLabel="types.ts:136" />

<MemberHeading id="inventory" depth="3" name="inventory" sig="inventory: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L126" sourceLabel="types.ts:126" />

<MemberHeading id="mode" depth="3" name="mode" sig="mode: 'applied' | 'dry-run'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L127" sourceLabel="types.ts:127" />

<MemberHeading id="note" depth="3" name="note" sig="note: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L137" sourceLabel="types.ts:137" />

<MemberHeading id="outcomes" depth="3" name="outcomes" sig="outcomes: TaskApplyOutcome[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L133" sourceLabel="types.ts:133" />

<MemberHeading id="playbook" depth="3" name="playbook" sig="playbook: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L125" sourceLabel="types.ts:125" />

<MemberHeading id="rendered" depth="3" name="rendered" sig="rendered: RenderedTemplate[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L134" sourceLabel="types.ts:134" />

<MemberHeading id="resolvedhosts" depth="3" name="resolvedHosts" sig="resolvedHosts: string[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L129" sourceLabel="types.ts:129" />

<MemberHeading id="skeleton" depth="3" name="skeleton" sig="skeleton: { host: string; module: string; task: string }[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L131" sourceLabel="types.ts:131" />

<MemberHeading id="tasks" depth="3" name="tasks" sig="tasks: { module: string; name: string }[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L130" sourceLabel="types.ts:130" />

<MemberHeading id="totals" depth="3" name="totals" sig="totals: ApplyTotals" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L132" sourceLabel="types.ts:132" />
