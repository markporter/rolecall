---
title: normalizePlaybook
kind: function
longname: module:config.normalizePlaybook
description: Normalize a validated playbook file (a top-level list of plays) into a canonical array of plays. The schema rejects a bare play object before this runs, so raw is always an array.
---

# normalizePlaybook

<Signature
  code="normalizePlaybook(
	raw: { checkpoint?: string; handlers?: { args?: Record<string, unknown>; become?: boolean; become_user?: string; checkpoint?: string; delegate_to?: string; environment?: Record<string, string>; hosts?: string | string[]; include_tasks?: string | string[]; listen?: string; loop?: unknown; module?: string; name: string; no_log?: boolean; notify?: string | string[]; register?: string; roleDir?: string; run_once?: boolean; tags?: string[]; tx?: string; when?: unknown }[]; hosts: string | string[]; imports?: string[]; name?: string; roles?: string[]; serial?: number; strategy?: 'linear' | 'free'; tags?: string[]; tasks: { args?: Record<string, unknown>; become?: boolean; become_user?: string; checkpoint?: string; delegate_to?: string; environment?: Record<string, string>; hosts?: string | string[]; include_tasks?: string | string[]; listen?: string; loop?: unknown; module?: string; name: string; no_log?: boolean; notify?: string | string[]; register?: string; roleDir?: string; run_once?: boolean; tags?: string[]; tx?: string; when?: unknown }[]; trigger?: { spec: string; type: 'cron' } | { path?: string; type: 'webhook' }; tx?: string; vars?: Record<string, unknown> }[],
): NormalizedPlaybook[]"
/>

<SourceLink href="/source/src/config/schema-ts/#L458" label="schema.ts:458" />

Normalize a validated playbook file (a top-level list of plays) into a canonical array of plays. The schema rejects a bare play object before this runs, so `raw` is always an array.

**Parameters**

- `raw` ({ checkpoint?: string; handlers?: { args?: Record\<string, unknown>; become?: boolean; become_user?: string; checkpoint?: string; [delegate_to](/module/config/normalizedtask#delegateto)?: string; environment?: Record\<string, string>; hosts?: string | string\[]; [include_tasks](/module/config/normalizedtask#includetasks)?: string | string\[]; [listen](/module/config/normalizedtask#listen)?: string; loop?: unknown; module?: string; name: string; no_log?: boolean; [notify](/module/config/normalizedtask#notify)?: string | string\[]; [register](/module/config/normalizedtask#register)?: string; roleDir?: string; [run_once](/module/config/normalizedtask#runonce)?: boolean; tags?: string\[]; tx?: string; [when](/module/config/normalizedtask#when)?: unknown }\[]; hosts: string | string\[]; [imports](/module/config/normalizedplaybook#imports)?: string\[]; name?: string; [roles](/module/config/normalizedplaybook#roles)?: string\[]; [serial](/module/config/normalizedplaybook#serial)?: number; [strategy](/module/config/normalizedplaybook#strategy)?: "linear" | "free"; tags?: string\[]; tasks: { args?: Record\<string, unknown>; become?: boolean; become_user?: string; checkpoint?: string; [delegate_to](/module/config/normalizedtask#delegateto)?: string; environment?: Record\<string, string>; hosts?: string | string\[]; [include_tasks](/module/config/normalizedtask#includetasks)?: string | string\[]; [listen](/module/config/normalizedtask#listen)?: string; loop?: unknown; module?: string; name: string; no_log?: boolean; [notify](/module/config/normalizedtask#notify)?: string | string\[]; [register](/module/config/normalizedtask#register)?: string; roleDir?: string; [run_once](/module/config/normalizedtask#runonce)?: boolean; tags?: string\[]; tx?: string; [when](/module/config/normalizedtask#when)?: unknown }\[]; trigger?: { spec: string; type: "cron" } | { path?: string; type: "webhook" }; tx?: string; vars?: Record\<string, unknown> }\[]) — Validated playbook file (an array of plays).

**Returns**

- [`NormalizedPlaybook`](/module/config/normalizedplaybook)`[]` — Canonical, serializable array of normalized plays.
