---
title: GlobalFlags
kind: interface
longname: module:cli.GlobalFlags
---

# GlobalFlags

<Signature
  code="interface GlobalFlags {
	check: boolean;
	diff: boolean;
	extraVars?: string;
	force: boolean;
	forks?: number;
	inventory?: string;
	limit?: string;
	output: string;
	profile: boolean;
	resume?: string;
	skipTags?: string;
	tags?: string;
	trace: boolean;
}"
/>

<SourceLink href="/source/src/cli/types-ts/#L17" label="types.ts:17" />

---

## Properties

<MemberHeading id="check" depth="3" name="check" sig="check: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L23" sourceLabel="types.ts:23" />

Accepted flag; documented as compute-only (executor pending, Todo 12).

<MemberHeading id="diff" depth="3" name="diff" sig="diff: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L25" sourceLabel="types.ts:25" />

Accepted flag; documented as compute-only (executor pending, Todo 12).

<MemberHeading id="extravars" depth="3" name="extraVars" sig="extraVars: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L39" sourceLabel="types.ts:39" />

Raw `--extra-vars` string (`key=value` pairs); parsed into a var map by the playbook command.

<MemberHeading id="force" depth="3" name="force" sig="force: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L21" sourceLabel="types.ts:21" />

Accepted flag; documented as compute-only (executor pending, Todo 12).

<MemberHeading id="forks" depth="3" name="forks" sig="forks: number" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L27" sourceLabel="types.ts:27" />

Concurrency fan-out (--forks N). Parsed to a number by the dispatcher.

<MemberHeading id="inventory" depth="3" name="inventory" sig="inventory: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L31" sourceLabel="types.ts:31" />

Optional inventory source for playbook run (resolves target patterns).

<MemberHeading id="limit" depth="3" name="limit" sig="limit: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L19" sourceLabel="types.ts:19" />

Target pattern restricting hosts (single pattern; RoleCall-style).

<MemberHeading id="output" depth="3" name="output" sig="output: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L29" sourceLabel="types.ts:29" />

Selected output plugin name (default "syslog").

<MemberHeading id="profile" depth="3" name="profile" sig="profile: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L35" sourceLabel="types.ts:35" />

Print a per-host/per-task performance profile at the end of the run (Todo 25).

<MemberHeading id="resume" depth="3" name="resume" sig="resume: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L37" sourceLabel="types.ts:37" />

Resume a prior run from a checkpoint: `<run_id>:<checkpoint>` (Todo 26).

<MemberHeading id="skiptags" depth="3" name="skipTags" sig="skipTags: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L43" sourceLabel="types.ts:43" />

Raw `--skip-tags` string (comma-separated tag list); parsed into a filter by the playbook command.

<MemberHeading id="tags" depth="3" name="tags" sig="tags: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L41" sourceLabel="types.ts:41" />

Raw `--tags` string (comma-separated tag list); parsed into a filter by the playbook command.

<MemberHeading id="trace" depth="3" name="trace" sig="trace: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L33" sourceLabel="types.ts:33" />

Emit + persist an execution-trace ledger for the run (Todo 25).
