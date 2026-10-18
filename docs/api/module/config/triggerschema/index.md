---
title: TriggerSchema
kind: variable
longname: module:config.TriggerSchema
---

# TriggerSchema

<Signature code="TriggerSchema: ZodDiscriminatedUnion<[ZodObject<{ spec: ZodString; type: ZodLiteral<'cron'> }, $strict>, ZodObject<{ path: ZodOptional<ZodString>; type: ZodLiteral<'webhook'> }, $strict>], 'type'>" />

<SourceLink href="/source/src/config/schema-ts/#L31" label="schema.ts:31" />

**Type**

`ZodDiscriminatedUnion<[ZodObject<{ spec: ZodString; type: ZodLiteral<"cron"> }, $strict>, ZodObject<{ path: ZodOptional<ZodString>; type: ZodLiteral<"webhook"> }, $strict>], "type">`
