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
	connection?: 'ssh' | 'local' | 'network';
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

<SourceLink href="/source/src/config/schema-ts/#L352" label="schema.ts:352" />

---

## Properties

<MemberHeading id="args" depth="3" name="args" sig="args: Record<string, unknown>" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L355" sourceLabel="schema.ts:355" />

<MemberHeading id="become" depth="3" name="become" sig="become: boolean" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L368" sourceLabel="schema.ts:368" />

When true, escalate privileges (sudo) on the target for this task.

<MemberHeading id="becomeuser" depth="3" name="become_user" sig="become_user: string" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L370" sourceLabel="schema.ts:370" />

When set, run escalated commands as this user (sudo -u ).

<MemberHeading id="checkpoint" depth="3" name="checkpoint" sig="checkpoint: string" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L384" sourceLabel="schema.ts:384" />

Checkpoint id this task is applied under (Todo 26, partial rollback).

<MemberHeading id="connection" depth="3" name="connection" sig="connection: 'ssh' | 'local' | 'network'" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L378" sourceLabel="schema.ts:378" />

Per-task transport override; when absent the host's default connection applies.

<MemberHeading id="delegateto" depth="3" name="delegate_to" sig="delegate_to: string" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L364" sourceLabel="schema.ts:364" />

<MemberHeading id="environment" depth="3" name="environment" sig="environment: Record<string, string>" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L372" sourceLabel="schema.ts:372" />

Environment variables exported for the module command (task-level).

<MemberHeading id="hosts" depth="3" name="hosts" sig="hosts: string[]" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L360" sourceLabel="schema.ts:360" />

Optional per-task target override; inherits the parent play `hosts` when absent.

<MemberHeading id="includetasks" depth="3" name="include_tasks" sig="include_tasks: string | string[]" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L362" sourceLabel="schema.ts:362" />

Optional `include_tasks` directive (load-time expansion); absent on executed tasks.

<MemberHeading id="listen" depth="3" name="listen" sig="listen: string" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L366" sourceLabel="schema.ts:366" />

<MemberHeading id="loop" depth="3" name="loop" sig="loop: unknown" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L357" sourceLabel="schema.ts:357" />

<MemberHeading id="module" depth="3" name="module" sig="module: string" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L354" sourceLabel="schema.ts:354" />

<MemberHeading id="name" depth="3" name="name" sig="name: string" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L353" sourceLabel="schema.ts:353" />

<MemberHeading id="nolog" depth="3" name="no_log" sig="no_log: boolean" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L374" sourceLabel="schema.ts:374" />

When true, suppress logging of task args / stdout / stderr.

<MemberHeading id="notify" depth="3" name="notify" sig="notify: string[]" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L358" sourceLabel="schema.ts:358" />

<MemberHeading id="register" depth="3" name="register" sig="register: string" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L363" sourceLabel="schema.ts:363" />

<MemberHeading id="roledir" depth="3" name="roleDir" sig="roleDir: string" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L380" sourceLabel="schema.ts:380" />

Absolute path of the role directory this task was composed from (set by the loader); enables role-relative path resolution.

<MemberHeading id="runonce" depth="3" name="run_once" sig="run_once: boolean" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L365" sourceLabel="schema.ts:365" />

<MemberHeading id="tags" depth="3" name="tags" sig="tags: string[]" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L376" sourceLabel="schema.ts:376" />

Labels selected at run time by the global `--tags` / `--skip-tags` flags. Absent => the task inherits its play's `tags`; present (even empty) => it replaces them (no union).

<MemberHeading id="tx" depth="3" name="tx" sig="tx: string" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L382" sourceLabel="schema.ts:382" />

Transaction id grouping dependent tasks/plays for rollback (Todo 26).

<MemberHeading id="when" depth="3" name="when" sig="when: unknown" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L356" sourceLabel="schema.ts:356" />
