---
title: ModuleContext
kind: interface
longname: module:modules.ModuleContext
description: Per-invocation context handed to a module's run (ADR 0013). host stays a direct convenience; registered becomes reg and loop item / index move under loop to mirror the 9-namespace TemplateVars shape.
---

# ModuleContext

<Signature
  code="interface ModuleContext {
	addHost?: (name: string, groups: string[], vars: Record<string, unknown>) => void;
	args: Record<string, unknown>;
	become?: boolean;
	become_user?: string;
	clearFacts?: () => void;
	connection: Connection;
	environment?: Record<string, string>;
	facts: Record<string, unknown>;
	host: string;
	loop?: { index?: number; item?: unknown };
	no_log?: boolean;
	playbookDir?: string;
	reg: Record<string, unknown>;
	resetConnection?: () => Promise<void>;
	roleDir?: string;
	setFact?: (key: string, value: unknown) => void;
	setReg?: (key: string, value: unknown) => void;
	setStat?: (key: string, value: unknown) => void;
	signal?: AbortSignal;
	vars: Record<string, unknown>;
}"
/>

<SourceLink href="/source/src/executor/module-ts/#L24" label="module.ts:24" />

Per-invocation context handed to a module's `run` (ADR 0013). `host` stays a direct convenience; `registered` becomes `reg` and loop `item`/`index` move under `loop` to mirror the 9-namespace TemplateVars shape.

---

## Properties

<MemberHeading id="addhost" depth="3" name="addHost" sig="addHost: (name: string, groups: string[], vars: Record<string, unknown>) => void" />

<MemberMeta badges="readonly" sourceHref="/source/src/executor/module-ts/#L56" sourceLabel="module.ts:56" />

When set, register a host into the run-level dynamic inventory (Ansible `add_host` alternate).

<MemberHeading id="args" depth="3" name="args" sig="args: Record<string, unknown>" />

<MemberMeta badges="readonly" sourceHref="/source/src/executor/module-ts/#L27" sourceLabel="module.ts:27" />

<MemberHeading id="become" depth="3" name="become" sig="become: boolean" />

<MemberMeta badges="readonly" sourceHref="/source/src/executor/module-ts/#L34" sourceLabel="module.ts:34" />

When true, escalate privileges (sudo) on the target for this invocation.

<MemberHeading id="becomeuser" depth="3" name="become_user" sig="become_user: string" />

<MemberMeta badges="readonly" sourceHref="/source/src/executor/module-ts/#L36" sourceLabel="module.ts:36" />

When set, run escalated commands as this user (sudo -u ). Implies become.

<MemberHeading id="clearfacts" depth="3" name="clearFacts" sig="clearFacts: () => void" />

<MemberMeta badges="readonly" sourceHref="/source/src/executor/module-ts/#L52" sourceLabel="module.ts:52" />

When set, clear all live facts for this host.

<MemberHeading id="connection" depth="3" name="connection" sig="connection: Connection" />

<MemberMeta badges="readonly" sourceHref="/source/src/executor/module-ts/#L26" sourceLabel="module.ts:26" />

<MemberHeading id="environment" depth="3" name="environment" sig="environment: Record<string, string>" />

<MemberMeta badges="readonly" sourceHref="/source/src/executor/module-ts/#L38" sourceLabel="module.ts:38" />

Environment variables to export for the module command (task-level).

<MemberHeading id="facts" depth="3" name="facts" sig="facts: Record<string, unknown>" />

<MemberMeta badges="readonly" sourceHref="/source/src/executor/module-ts/#L29" sourceLabel="module.ts:29" />

<MemberHeading id="host" depth="3" name="host" sig="host: string" />

<MemberMeta badges="readonly" sourceHref="/source/src/executor/module-ts/#L25" sourceLabel="module.ts:25" />

<MemberHeading id="loop" depth="3" name="loop" sig="loop: { index?: number; item?: unknown }" />

<MemberMeta badges="readonly" sourceHref="/source/src/executor/module-ts/#L31" sourceLabel="module.ts:31" />

**Properties**

- `index` (number, optional)
- `item` (unknown, optional)

<MemberHeading id="nolog" depth="3" name="no_log" sig="no_log: boolean" />

<MemberMeta badges="readonly" sourceHref="/source/src/executor/module-ts/#L40" sourceLabel="module.ts:40" />

When true, suppress logging of task args / stdout / stderr for this task.

<MemberHeading id="playbookdir" depth="3" name="playbookDir" sig="playbookDir: string" />

<MemberMeta badges="readonly" sourceHref="/source/src/executor/module-ts/#L44" sourceLabel="module.ts:44" />

Absolute directory of the playbook file being executed; enables playbook-relative path resolution.

<MemberHeading id="reg" depth="3" name="reg" sig="reg: Record<string, unknown>" />

<MemberMeta badges="readonly" sourceHref="/source/src/executor/module-ts/#L30" sourceLabel="module.ts:30" />

<MemberHeading id="resetconnection" depth="3" name="resetConnection" sig="resetConnection: () => Promise<void>" />

<MemberMeta badges="readonly" sourceHref="/source/src/executor/module-ts/#L54" sourceLabel="module.ts:54" />

When set, drop the cached transport connection so the next task re-establishes it.

<MemberHeading id="roledir" depth="3" name="roleDir" sig="roleDir: string" />

<MemberMeta badges="readonly" sourceHref="/source/src/executor/module-ts/#L42" sourceLabel="module.ts:42" />

Absolute role directory this task was composed from (if any); enables role-relative path resolution.

<MemberHeading id="setfact" depth="3" name="setFact" sig="setFact: (key: string, value: unknown) => void" />

<MemberMeta badges="readonly" sourceHref="/source/src/executor/module-ts/#L46" sourceLabel="module.ts:46" />

When set, persist a host fact live so downstream tasks see it via `$var: facts.*`.

<MemberHeading id="setreg" depth="3" name="setReg" sig="setReg: (key: string, value: unknown) => void" />

<MemberMeta badges="readonly" sourceHref="/source/src/executor/module-ts/#L48" sourceLabel="module.ts:48" />

When set, persist a runtime register value live so downstream tasks see it via `$var: reg.*`.

<MemberHeading id="setstat" depth="3" name="setStat" sig="setStat: (key: string, value: unknown) => void" />

<MemberMeta badges="readonly" sourceHref="/source/src/executor/module-ts/#L50" sourceLabel="module.ts:50" />

When set, aggregate a run-level stat (persisted for the duration of the run).

<MemberHeading id="signal" depth="3" name="signal" sig="signal: AbortSignal" />

<MemberMeta badges="readonly" sourceHref="/source/src/executor/module-ts/#L32" sourceLabel="module.ts:32" />

<MemberHeading id="vars" depth="3" name="vars" sig="vars: Record<string, unknown>" />

<MemberMeta badges="readonly" sourceHref="/source/src/executor/module-ts/#L28" sourceLabel="module.ts:28" />
