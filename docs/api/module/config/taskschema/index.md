---
title: TaskSchema
kind: variable
longname: module:config.TaskSchema
---

# TaskSchema

<Signature code="TaskSchema: ZodObject<{ args: ZodOptional<ZodRecord<ZodString, ZodUnknown>>; become: ZodOptional<ZodBoolean>; become_user: ZodOptional<ZodString>; checkpoint: ZodOptional<ZodString>; delegate_to: ZodOptional<ZodString>; environment: ZodOptional<ZodRecord<ZodString, ZodString>>; hosts: ZodOptional<ZodUnion<readonly [ZodString, ZodArray<ZodString>]>>; include_tasks: ZodOptional<ZodUnion<readonly [ZodString, ZodArray<ZodString>]>>; listen: ZodOptional<ZodString>; loop: ZodOptional<ZodUnknown>; module: ZodOptional<ZodString>; name: ZodString; no_log: ZodOptional<ZodBoolean>; notify: ZodOptional<ZodUnion<readonly [ZodString, ZodArray<ZodString>]>>; register: ZodOptional<ZodString>; roleDir: ZodOptional<ZodString>; run_once: ZodOptional<ZodBoolean>; tags: ZodOptional<ZodArray<ZodString>>; tx: ZodOptional<ZodString>; when: ZodOptional<ZodUnknown> }, $strict>" />

<SourceLink href="/source/src/config/schema-ts/#L50" label="schema.ts:50" />

**Type**

`ZodObject<{ args: ZodOptional<ZodRecord<ZodString, ZodUnknown>>; become: ZodOptional<ZodBoolean>; become_user: ZodOptional<ZodString>; checkpoint: ZodOptional<ZodString>; delegate_to: ZodOptional<ZodString>; environment: ZodOptional<ZodRecord<ZodString, ZodString>>; hosts: ZodOptional<ZodUnion<readonly [ZodString, ZodArray<ZodString>]>>; include_tasks: ZodOptional<ZodUnion<readonly [ZodString, ZodArray<ZodString>]>>; listen: ZodOptional<ZodString>; loop: ZodOptional<ZodUnknown>; module: ZodOptional<ZodString>; name: ZodString; no_log: ZodOptional<ZodBoolean>; notify: ZodOptional<ZodUnion<readonly [ZodString, ZodArray<ZodString>]>>; register: ZodOptional<ZodString>; roleDir: ZodOptional<ZodString>; run_once: ZodOptional<ZodBoolean>; tags: ZodOptional<ZodArray<ZodString>>; tx: ZodOptional<ZodString>; when: ZodOptional<ZodUnknown> }, $strict>`
