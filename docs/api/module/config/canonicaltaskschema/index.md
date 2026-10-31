---
title: CanonicalTaskSchema
kind: variable
longname: module:config.CanonicalTaskSchema
---

# CanonicalTaskSchema

<Signature code="CanonicalTaskSchema: ZodPreprocess<ZodObject<{ args: ZodOptional<ZodRecord<ZodString, ZodUnknown>>; become: ZodOptional<ZodBoolean>; become_user: ZodOptional<ZodString>; checkpoint: ZodOptional<ZodString>; connection: ZodOptional<ZodEnum<{ local: 'local'; network: 'network'; ssh: 'ssh' }>>; delegate_to: ZodOptional<ZodString>; environment: ZodOptional<ZodRecord<ZodString, ZodString>>; hosts: ZodOptional<ZodUnion<readonly [ZodString, ZodArray<ZodString>]>>; include_tasks: ZodOptional<ZodUnion<readonly [ZodString, ZodArray<ZodString>]>>; listen: ZodOptional<ZodString>; loop: ZodOptional<ZodUnknown>; module: ZodOptional<ZodString>; name: ZodString; no_log: ZodOptional<ZodBoolean>; notify: ZodOptional<ZodUnion<readonly [ZodString, ZodArray<ZodString>]>>; register: ZodOptional<ZodString>; roleDir: ZodOptional<ZodString>; run_once: ZodOptional<ZodBoolean>; tags: ZodOptional<ZodArray<ZodString>>; tx: ZodOptional<ZodString>; when: ZodOptional<ZodUnknown> }, $strict>, unknown>" />

<SourceLink href="/source/src/config/schema-ts/#L160" label="schema.ts:160" />

**Type**

`ZodPreprocess<ZodObject<{ args: ZodOptional<ZodRecord<ZodString, ZodUnknown>>; become: ZodOptional<ZodBoolean>; become_user: ZodOptional<ZodString>; checkpoint: ZodOptional<ZodString>; connection: ZodOptional<ZodEnum<{ local: "local"; network: "network"; ssh: "ssh" }>>; delegate_to: ZodOptional<ZodString>; environment: ZodOptional<ZodRecord<ZodString, ZodString>>; hosts: ZodOptional<ZodUnion<readonly [ZodString, ZodArray<ZodString>]>>; include_tasks: ZodOptional<ZodUnion<readonly [ZodString, ZodArray<ZodString>]>>; listen: ZodOptional<ZodString>; loop: ZodOptional<ZodUnknown>; module: ZodOptional<ZodString>; name: ZodString; no_log: ZodOptional<ZodBoolean>; notify: ZodOptional<ZodUnion<readonly [ZodString, ZodArray<ZodString>]>>; register: ZodOptional<ZodString>; roleDir: ZodOptional<ZodString>; run_once: ZodOptional<ZodBoolean>; tags: ZodOptional<ZodArray<ZodString>>; tx: ZodOptional<ZodString>; when: ZodOptional<ZodUnknown> }, $strict>, unknown>`
