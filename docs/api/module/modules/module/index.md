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
	network?: boolean;
	supportsCheck?: boolean;
	run(ctx: ModuleContext): Promise<ModuleResult>;
}"
/>

<SourceLink href="/source/src/executor/module-ts/#L83" label="module.ts:83" />

A pluggable unit of work. Registered by name; resolved at dispatch time.

---

## Properties

<MemberHeading id="factgatherer" depth="3" name="factGatherer" sig="factGatherer: FactGatherer" />

<MemberMeta badges="readonly" sourceHref="/source/src/executor/module-ts/#L93" sourceLabel="module.ts:93" />

Optional gatherer that produces this module's [facts](/module/modules/module#facts) over a connection.

<MemberHeading id="facts" depth="3" name="facts" sig="facts: readonly VarManifestEntry[]" />

<MemberMeta badges="readonly" sourceHref="/source/src/executor/module-ts/#L91" sourceLabel="module.ts:91" />

Typed fact schemas this module can produce. When present, the module is auto-registered as a fact plugin (via [registerModule](/module/modules/registermodule)) so its facts are gathered by the engine and `$var: facts.*` references to them validate under `var_strict`.

<MemberHeading id="name" depth="3" name="name" sig="name: string" />

<MemberMeta badges="readonly" sourceHref="/source/src/executor/module-ts/#L84" sourceLabel="module.ts:84" />

<MemberHeading id="network" depth="3" name="network" sig="network: boolean" />

<MemberMeta badges="readonly" sourceHref="/source/src/executor/module-ts/#L108" sourceLabel="module.ts:108" />

Declares that this trusted module may need local network access through the connection (e.g. get_url/git/package managers). Under ADR 0025's `module` network mode, the executor wraps `connection.exec` with the `networked` profile for this module; shell/command/script/raw never set it.

<MemberHeading id="supportscheck" depth="3" name="supportsCheck" sig="supportsCheck: boolean" />

<MemberMeta badges="readonly" sourceHref="/source/src/executor/module-ts/#L101" sourceLabel="module.ts:101" />

Declares that `run` honors the global check-mode passthrough (`_check`/`check`) and never mutates target state when it is set. Modules exposing a `check` method are treated as supporting check mode automatically; modules that are inherently read-only may also set this. Unsupported modules are skipped in `--check` rather than run.

## Methods

<MemberHeading id="run" depth="3" name="run" sig="run(ctx: ModuleContext): Promise<ModuleResult>" />

<MemberMeta badges="async" sourceHref="/source/src/executor/module-ts/#L85" sourceLabel="module.ts:85" />

**Parameters**

- `ctx` ([ModuleContext](/module/modules/modulecontext))

**Returns**

- `Promise<`[`ModuleResult`](/module/modules/moduleresult)`>`
