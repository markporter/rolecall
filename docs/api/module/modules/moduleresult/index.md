---
title: ModuleResult
kind: interface
longname: module:modules.ModuleResult
description: Result returned by a module invocation.
---

# ModuleResult

<Signature
  code="interface ModuleResult {
	changed: boolean;
	data?: Record<string, unknown>;
	failed?: boolean;
	halt?: 'host' | 'play';
	msg?: string;
	skipped?: boolean;
	stderr?: string;
	stdout?: string;
}"
/>

<SourceLink href="/source/src/executor/module-ts/#L70" label="module.ts:70" />

Result returned by a module invocation.

---

## Properties

<MemberHeading id="changed" depth="3" name="changed" sig="changed: boolean" />

<MemberMeta sourceHref="/source/src/executor/module-ts/#L71" sourceLabel="module.ts:71" />

<MemberHeading id="data" depth="3" name="data" sig="data: Record<string, unknown>" />

<MemberMeta sourceHref="/source/src/executor/module-ts/#L77" sourceLabel="module.ts:77" />

<MemberHeading id="failed" depth="3" name="failed" sig="failed: boolean" />

<MemberMeta sourceHref="/source/src/executor/module-ts/#L72" sourceLabel="module.ts:72" />

<MemberHeading id="halt" depth="3" name="halt" sig="halt: 'host' | 'play'" />

<MemberMeta sourceHref="/source/src/executor/module-ts/#L79" sourceLabel="module.ts:79" />

Request the executor halt this host (`"host"`) or the whole play (`"play"`).

<MemberHeading id="msg" depth="3" name="msg" sig="msg: string" />

<MemberMeta sourceHref="/source/src/executor/module-ts/#L76" sourceLabel="module.ts:76" />

<MemberHeading id="skipped" depth="3" name="skipped" sig="skipped: boolean" />

<MemberMeta sourceHref="/source/src/executor/module-ts/#L73" sourceLabel="module.ts:73" />

<MemberHeading id="stderr" depth="3" name="stderr" sig="stderr: string" />

<MemberMeta sourceHref="/source/src/executor/module-ts/#L75" sourceLabel="module.ts:75" />

<MemberHeading id="stdout" depth="3" name="stdout" sig="stdout: string" />

<MemberMeta sourceHref="/source/src/executor/module-ts/#L74" sourceLabel="module.ts:74" />
