---
title: FactsEngineOptions
kind: interface
longname: module:facts.FactsEngineOptions
---

# FactsEngineOptions

<Signature
  code="interface FactsEngineOptions {
	cache?: FactCache;
	gatherers?: readonly FactGatherer[];
	plugins?: readonly FactPlugin[];
}"
/>

<SourceLink href="/source/src/facts/engine-ts/#L28" label="engine.ts:28" />

---

## Properties

<MemberHeading id="cache" depth="3" name="cache" sig="cache: FactCache" />

<MemberMeta sourceHref="/source/src/facts/engine-ts/#L29" sourceLabel="engine.ts:29" />

<MemberHeading id="gatherers" depth="3" name="gatherers" sig="gatherers: readonly FactGatherer[]" />

<MemberMeta sourceHref="/source/src/facts/engine-ts/#L31" sourceLabel="engine.ts:31" />

Extra gatherers merged with the built-ins.

<MemberHeading id="plugins" depth="3" name="plugins" sig="plugins: readonly FactPlugin[]" />

<MemberMeta sourceHref="/source/src/facts/engine-ts/#L33" sourceLabel="engine.ts:33" />

User plugins whose gatherers are merged with the built-ins.
