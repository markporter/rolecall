---
title: FactPlugin
kind: interface
longname: module:facts.FactPlugin
description: "User-extensible fact plugin: bundles one or more gatherers under a name so users can add custom fact sources without touching the engine. Optionally declares the fact schemas it owns ( declares ) so $var: facts.* references to them validate under var_strict ."
---

# FactPlugin

<Signature
  code="interface FactPlugin {
	declares?: readonly VarManifestEntry[];
	gatherers: readonly FactGatherer[];
	name: string;
}"
/>

<SourceLink href="/source/src/facts/types-ts/#L63" label="types.ts:63" />

User-extensible fact plugin: bundles one or more gatherers under a name so users can add custom fact sources without touching the engine. Optionally declares the fact schemas it owns (`declares`) so `$var: facts.*` references to them validate under `var_strict`.

---

## Properties

<MemberHeading id="declares" depth="3" name="declares" sig="declares: readonly VarManifestEntry[]" />

<MemberMeta badges="readonly" sourceHref="/source/src/facts/types-ts/#L67" sourceLabel="types.ts:67" />

Typed fact schemas this plugin can produce; merged into the declared-fact registry.

<MemberHeading id="gatherers" depth="3" name="gatherers" sig="gatherers: readonly FactGatherer[]" />

<MemberMeta badges="readonly" sourceHref="/source/src/facts/types-ts/#L65" sourceLabel="types.ts:65" />

<MemberHeading id="name" depth="3" name="name" sig="name: string" />

<MemberMeta badges="readonly" sourceHref="/source/src/facts/types-ts/#L64" sourceLabel="types.ts:64" />
