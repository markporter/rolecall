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

<SourceLink href="/source/src/executor/module-ts/#L60" label="module.ts:60" />

Result returned by a module invocation.

---

## Properties

<MemberHeading id="changed" depth="3" name="changed" sig="changed: boolean" />

<MemberMeta sourceHref="/source/src/executor/module-ts/#L61" sourceLabel="module.ts:61" />

<MemberHeading id="data" depth="3" name="data" sig="data: Record<string, unknown>" />

<MemberMeta sourceHref="/source/src/executor/module-ts/#L67" sourceLabel="module.ts:67" />

<MemberHeading id="failed" depth="3" name="failed" sig="failed: boolean" />

<MemberMeta sourceHref="/source/src/executor/module-ts/#L62" sourceLabel="module.ts:62" />

<MemberHeading id="halt" depth="3" name="halt" sig="halt: 'host' | 'play'" />

<MemberMeta sourceHref="/source/src/executor/module-ts/#L69" sourceLabel="module.ts:69" />

Request the executor halt this host (`"host"`) or the whole play (`"play"`).

<MemberHeading id="msg" depth="3" name="msg" sig="msg: string" />

<MemberMeta sourceHref="/source/src/executor/module-ts/#L66" sourceLabel="module.ts:66" />

<MemberHeading id="skipped" depth="3" name="skipped" sig="skipped: boolean" />

<MemberMeta sourceHref="/source/src/executor/module-ts/#L63" sourceLabel="module.ts:63" />

<MemberHeading id="stderr" depth="3" name="stderr" sig="stderr: string" />

<MemberMeta sourceHref="/source/src/executor/module-ts/#L65" sourceLabel="module.ts:65" />

<MemberHeading id="stdout" depth="3" name="stdout" sig="stdout: string" />

<MemberMeta sourceHref="/source/src/executor/module-ts/#L64" sourceLabel="module.ts:64" />
