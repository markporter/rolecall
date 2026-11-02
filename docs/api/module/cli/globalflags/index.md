---
title: GlobalFlags
kind: interface
longname: module:cli.GlobalFlags
---

# GlobalFlags

<Signature
  code="interface GlobalFlags {
	allowEgress?: EgressRule[];
	allowUnsafeTemplateCode?: boolean;
	check: boolean;
	configDir?: string;
	diff: boolean;
	dryRun?: boolean;
	extraVars?: string;
	force: boolean;
	forks?: number;
	fromDir?: string;
	inventory?: string;
	isolation?: IsolationBackendName;
	isolationNetwork?: 'module' | 'all' | 'none';
	limit?: string;
	mounts?: IsolationMount[];
	nonInteractive?: boolean;
	noRestart?: boolean;
	noService?: boolean;
	output: string;
	prefix?: string;
	profile: boolean;
	purge?: boolean;
	resume?: string;
	rollback?: boolean;
	skipTags?: string;
	stateDir?: string;
	system?: boolean;
	tags?: string;
	trace: boolean;
	user?: boolean;
	yes?: boolean;
}"
/>

<SourceLink href="/source/src/cli/types-ts/#L17" label="types.ts:17" />

---

## Properties

<MemberHeading id="allowegress" depth="3" name="allowEgress" sig="allowEgress: EgressRule[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L51" sourceLabel="types.ts:51" />

Ephemeral destination whitelist entries (repeatable --allow-egress).

<MemberHeading id="allowunsafetemplatecode" depth="3" name="allowUnsafeTemplateCode" sig="allowUnsafeTemplateCode: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L53" sourceLabel="types.ts:53" />

Explicit unsafe override for restricted code with --isolation none.

<MemberHeading id="check" depth="3" name="check" sig="check: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L23" sourceLabel="types.ts:23" />

Accepted flag; documented as compute-only (executor pending, Todo 12).

<MemberHeading id="configdir" depth="3" name="configDir" sig="configDir: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L69" sourceLabel="types.ts:69" />

\--config-dir override.

<MemberHeading id="diff" depth="3" name="diff" sig="diff: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L25" sourceLabel="types.ts:25" />

Accepted flag; documented as compute-only (executor pending, Todo 12).

<MemberHeading id="dryrun" depth="3" name="dryRun" sig="dryRun: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L61" sourceLabel="types.ts:61" />

\--dry-run: plan only.

<MemberHeading id="extravars" depth="3" name="extraVars" sig="extraVars: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L39" sourceLabel="types.ts:39" />

Raw `--extra-vars` string (`key=value` pairs); parsed into a var map by the playbook command.

<MemberHeading id="force" depth="3" name="force" sig="force: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L21" sourceLabel="types.ts:21" />

Accepted flag; documented as compute-only (executor pending, Todo 12).

<MemberHeading id="forks" depth="3" name="forks" sig="forks: number" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L27" sourceLabel="types.ts:27" />

Concurrency fan-out (--forks N). Parsed to a number by the dispatcher.

<MemberHeading id="fromdir" depth="3" name="fromDir" sig="fromDir: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L75" sourceLabel="types.ts:75" />

\--from-dir: local artifact directory for install/update.

<MemberHeading id="inventory" depth="3" name="inventory" sig="inventory: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L31" sourceLabel="types.ts:31" />

Optional inventory source for playbook run (resolves target patterns).

<MemberHeading id="isolation" depth="3" name="isolation" sig="isolation: IsolationBackendName" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L45" sourceLabel="types.ts:45" />

Requested local isolation backend (--isolation; default auto).

<MemberHeading id="isolationnetwork" depth="3" name="isolationNetwork" sig="isolationNetwork: 'module' | 'all' | 'none'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L47" sourceLabel="types.ts:47" />

Network policy under isolation (--isolation-network; default module).

<MemberHeading id="limit" depth="3" name="limit" sig="limit: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L19" sourceLabel="types.ts:19" />

Target pattern restricting hosts (single pattern; RoleCall-style).

<MemberHeading id="mounts" depth="3" name="mounts" sig="mounts: IsolationMount[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L49" sourceLabel="types.ts:49" />

Explicit filesystem grants (repeatable --mount).

<MemberHeading id="noninteractive" depth="3" name="nonInteractive" sig="nonInteractive: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L65" sourceLabel="types.ts:65" />

\--non-interactive: never prompt.

<MemberHeading id="norestart" depth="3" name="noRestart" sig="noRestart: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L79" sourceLabel="types.ts:79" />

\--no-restart: do not restart the service after an update.

<MemberHeading id="noservice" depth="3" name="noService" sig="noService: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L59" sourceLabel="types.ts:59" />

\--no-service: skip service unit generation.

<MemberHeading id="output" depth="3" name="output" sig="output: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L29" sourceLabel="types.ts:29" />

Selected output plugin name (default "syslog").

<MemberHeading id="prefix" depth="3" name="prefix" sig="prefix: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L67" sourceLabel="types.ts:67" />

\--prefix: program directory override.

<MemberHeading id="profile" depth="3" name="profile" sig="profile: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L35" sourceLabel="types.ts:35" />

Print a per-host/per-task performance profile at the end of the run (Todo 25).

<MemberHeading id="purge" depth="3" name="purge" sig="purge: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L73" sourceLabel="types.ts:73" />

\--purge: remove config/state/cache on uninstall.

<MemberHeading id="resume" depth="3" name="resume" sig="resume: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L37" sourceLabel="types.ts:37" />

Resume a prior run from a checkpoint: `<run_id>:<checkpoint>` (Todo 26).

<MemberHeading id="rollback" depth="3" name="rollback" sig="rollback: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L77" sourceLabel="types.ts:77" />

\--rollback: switch back to the previous version.

<MemberHeading id="skiptags" depth="3" name="skipTags" sig="skipTags: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L43" sourceLabel="types.ts:43" />

Raw `--skip-tags` string (comma-separated tag list); parsed into a filter by the playbook command.

<MemberHeading id="statedir" depth="3" name="stateDir" sig="stateDir: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L71" sourceLabel="types.ts:71" />

\--state-dir override.

<MemberHeading id="system" depth="3" name="system" sig="system: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L55" sourceLabel="types.ts:55" />

\--system install scope.

<MemberHeading id="tags" depth="3" name="tags" sig="tags: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L41" sourceLabel="types.ts:41" />

Raw `--tags` string (comma-separated tag list); parsed into a filter by the playbook command.

<MemberHeading id="trace" depth="3" name="trace" sig="trace: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L33" sourceLabel="types.ts:33" />

Emit + persist an execution-trace ledger for the run (Todo 25).

<MemberHeading id="user" depth="3" name="user" sig="user: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L57" sourceLabel="types.ts:57" />

\--user install scope.

<MemberHeading id="yes" depth="3" name="yes" sig="yes: boolean" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L63" sourceLabel="types.ts:63" />

\--yes: apply without prompting.
