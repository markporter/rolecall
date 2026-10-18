---
title: Module
kind: interface
longname: module:modules.Module
description: A pluggable unit of work. Registered by name; resolved at dispatch time.
---

# Module

<Signature
  code="interface Module {
	factGatherer?: FactGatherer;
	facts?: readonly VarManifestEntry[];
	name: string;
	run(ctx: ModuleContext): Promise<ModuleResult>;
}"
/>

<SourceLink href="/source/src/executor/module-ts/#L73" label="module.ts:73" />

A pluggable unit of work. Registered by name; resolved at dispatch time.

---

## Properties

<MemberHeading id="factgatherer" depth="3" name="factGatherer" sig="factGatherer: FactGatherer" />

<MemberMeta badges="readonly" sourceHref="/source/src/executor/module-ts/#L83" sourceLabel="module.ts:83" />

Optional gatherer that produces this module's [facts](/module/modules/module#facts) over a connection.

<MemberHeading id="facts" depth="3" name="facts" sig="facts: readonly VarManifestEntry[]" />

<MemberMeta badges="readonly" sourceHref="/source/src/executor/module-ts/#L81" sourceLabel="module.ts:81" />

Typed fact schemas this module can produce. When present, the module is auto-registered as a fact plugin (via [registerModule](/module/modules/registermodule)) so its facts are gathered by the engine and `$var: facts.*` references to them validate under `var_strict`.

<MemberHeading id="name" depth="3" name="name" sig="name: string" />

<MemberMeta badges="readonly" sourceHref="/source/src/executor/module-ts/#L74" sourceLabel="module.ts:74" />

## Methods

<MemberHeading id="run" depth="3" name="run" sig="run(ctx: ModuleContext): Promise<ModuleResult>" />

<MemberMeta badges="async" sourceHref="/source/src/executor/module-ts/#L75" sourceLabel="module.ts:75" />

**Parameters**

- `ctx` ([ModuleContext](/module/modules/modulecontext))

**Returns**

- `Promise<`[`ModuleResult`](/module/modules/moduleresult)`>`
