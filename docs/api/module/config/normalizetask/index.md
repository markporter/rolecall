---
title: normalizeTask
kind: function
longname: module:config.normalizeTask
description: Normalize a validated RawTask into canonical form (string→list, omitted→defaults).
---

# normalizeTask

<Signature
  code="normalizeTask(
	raw: { args?: Record<string, unknown>; become?: boolean; become_user?: string; checkpoint?: string; delegate_to?: string; environment?: Record<string, string>; hosts?: string | string[]; include_tasks?: string | string[]; listen?: string; loop?: unknown; module?: string; name: string; no_log?: boolean; notify?: string | string[]; register?: string; roleDir?: string; run_once?: boolean; tags?: string[]; tx?: string; when?: unknown },
): NormalizedTask"
/>

<SourceLink href="/source/src/config/schema-ts/#L398" label="schema.ts:398" />

Normalize a validated RawTask into canonical form (string→list, omitted→defaults).

**Parameters**

- `raw` ({ args?: Record\<string, unknown>; become?: boolean; become_user?: string; checkpoint?: string; [delegate_to](/module/config/normalizedtask#delegateto)?: string; environment?: Record\<string, string>; hosts?: string | string\[]; [include_tasks](/module/config/normalizedtask#includetasks)?: string | string\[]; [listen](/module/config/normalizedtask#listen)?: string; loop?: unknown; module?: string; name: string; no_log?: boolean; [notify](/module/config/normalizedtask#notify)?: string | string\[]; [register](/module/config/normalizedtask#register)?: string; roleDir?: string; [run_once](/module/config/normalizedtask#runonce)?: boolean; tags?: string\[]; tx?: string; [when](/module/config/normalizedtask#when)?: unknown })

**Properties**

- `args` (Record\<string, unknown>, optional)
- `become` (boolean, optional)
- `become_user` (string, optional)
- `checkpoint` (string, optional)
- `delegate_to` (string, optional)
- `environment` (Record\<string, string>, optional)
- `hosts` (string | string\[], optional)
- `include_tasks` (string | string\[], optional)
- `listen` (string, optional)
- `loop` (unknown, optional)
- `module` (string, optional)
- `name` (string)
- `no_log` (boolean, optional)
- `notify` (string | string\[], optional)
- `register` (string, optional)
- `roleDir` (string, optional)
- `run_once` (boolean, optional)
- `tags` (string\[], optional)
- `tx` (string, optional)
- `when` (unknown, optional)

**Returns**

- [`NormalizedTask`](/module/config/normalizedtask)
