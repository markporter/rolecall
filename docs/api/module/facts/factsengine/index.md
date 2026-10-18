---
title: FactsEngine
kind: class
longname: module:facts.FactsEngine
---

# FactsEngine

<SourceLink href="/source/src/facts/engine-ts/#L81" label="engine.ts:81" />

---

## Constructors

<MemberHeading id="constructor" depth="3" name="constructor" sig="new FactsEngine(opts: FactsEngineOptions): FactsEngine" />

**Parameters**

- `opts` ([FactsEngineOptions](/module/facts/factsengineoptions), default: "{}")

**Returns**

`FactsEngine`

---

## Methods

<MemberHeading
  id="gatherfacts"
  depth="3"
  name="gatherFacts"
  sig="gatherFacts(
	connection: Connection,
	requestedKeys: string[],
	opts: GatherOptions,
): Promise<FactMap>"
/>

<MemberMeta badges="async" sourceHref="/source/src/facts/engine-ts/#L112" sourceLabel="engine.ts:112" />

Gather only the requested fact keys for `connection`. Returns a flat map of the gathered keys. On cache hit the SAME cached object reference is returned (no re-gather). Gatherer failures are skipped by default (graceful partial).

**Parameters**

- `connection` ([Connection](/module/transport/connection))
- `requestedKeys` (string\[])
- `opts` ([GatherOptions](/module/facts/gatheroptions), default: "{}")

**Returns**

- `Promise<`[`FactMap`](/module/facts/factmap)`>`

<MemberHeading id="registerplugin" depth="3" name="registerPlugin" sig="registerPlugin(plugin: FactPlugin): void" />

<MemberMeta sourceHref="/source/src/facts/engine-ts/#L93" sourceLabel="engine.ts:93" />

Register a user FactPlugin at runtime.

**Parameters**

- `plugin` ([FactPlugin](/module/facts/factplugin))

**Returns**

- `void`
