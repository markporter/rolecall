---
title: NormalizedTask
kind: interface
longname: module:config.NormalizedTask
---

# NormalizedTask

<Signature
  code="interface NormalizedTask {
	args: Record<string, unknown>;
	become?: boolean;
	become_user?: string;
	checkpoint?: string;
	delegate_to?: string;
	environment?: Record<string, string>;
	hosts?: string[];
	include_tasks?: string | string[];
	listen?: string;
	loop?: unknown;
	module?: string;
	name: string;
	no_log?: boolean;
	notify: string[];
	register?: string;
	roleDir?: string;
	run_once?: boolean;
	tags?: string[];
	tx?: string;
	when?: unknown;
}"
/>

<SourceLink href="/source/src/config/schema-ts/#L317" label="schema.ts:317" />

---

## Properties

<MemberHeading id="args" depth="3" name="args" sig="args: Record<string, unknown>" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L320" sourceLabel="schema.ts:320" />

<MemberHeading id="become" depth="3" name="become" sig="become: boolean" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L333" sourceLabel="schema.ts:333" />

When true, escalate privileges (sudo) on the target for this task.

<MemberHeading id="becomeuser" depth="3" name="become_user" sig="become_user: string" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L335" sourceLabel="schema.ts:335" />

When set, run escalated commands as this user (sudo -u ).

<MemberHeading id="checkpoint" depth="3" name="checkpoint" sig="checkpoint: string" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L347" sourceLabel="schema.ts:347" />

Checkpoint id this task is applied under (Todo 26, partial rollback).

<MemberHeading id="delegateto" depth="3" name="delegate_to" sig="delegate_to: string" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L329" sourceLabel="schema.ts:329" />

<MemberHeading id="environment" depth="3" name="environment" sig="environment: Record<string, string>" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L337" sourceLabel="schema.ts:337" />

Environment variables exported for the module command (task-level).

<MemberHeading id="hosts" depth="3" name="hosts" sig="hosts: string[]" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L325" sourceLabel="schema.ts:325" />

Optional per-task target override; inherits the parent play `hosts` when absent.

<MemberHeading id="includetasks" depth="3" name="include_tasks" sig="include_tasks: string | string[]" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L327" sourceLabel="schema.ts:327" />

Optional `include_tasks` directive (load-time expansion); absent on executed tasks.

<MemberHeading id="listen" depth="3" name="listen" sig="listen: string" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L331" sourceLabel="schema.ts:331" />

<MemberHeading id="loop" depth="3" name="loop" sig="loop: unknown" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L322" sourceLabel="schema.ts:322" />

<MemberHeading id="module" depth="3" name="module" sig="module: string" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L319" sourceLabel="schema.ts:319" />

<MemberHeading id="name" depth="3" name="name" sig="name: string" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L318" sourceLabel="schema.ts:318" />

<MemberHeading id="nolog" depth="3" name="no_log" sig="no_log: boolean" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L339" sourceLabel="schema.ts:339" />

When true, suppress logging of task args / stdout / stderr.

<MemberHeading id="notify" depth="3" name="notify" sig="notify: string[]" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L323" sourceLabel="schema.ts:323" />

<MemberHeading id="register" depth="3" name="register" sig="register: string" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L328" sourceLabel="schema.ts:328" />

<MemberHeading id="roledir" depth="3" name="roleDir" sig="roleDir: string" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L343" sourceLabel="schema.ts:343" />

Absolute path of the role directory this task was composed from (set by the loader); enables role-relative path resolution.

<MemberHeading id="runonce" depth="3" name="run_once" sig="run_once: boolean" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L330" sourceLabel="schema.ts:330" />

<MemberHeading id="tags" depth="3" name="tags" sig="tags: string[]" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L341" sourceLabel="schema.ts:341" />

Labels selected at run time by the global `--tags` / `--skip-tags` flags. Absent => the task inherits its play's `tags`; present (even empty) => it replaces them (no union).

<MemberHeading id="tx" depth="3" name="tx" sig="tx: string" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L345" sourceLabel="schema.ts:345" />

Transaction id grouping dependent tasks/plays for rollback (Todo 26).

<MemberHeading id="when" depth="3" name="when" sig="when: unknown" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L321" sourceLabel="schema.ts:321" />
