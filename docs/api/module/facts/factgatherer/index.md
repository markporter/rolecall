---
title: FactGatherer
kind: interface
longname: module:facts.FactGatherer
description: A gatherer produces a SUBSET of facts for a connection. It declares the keys it can provide so the engine can run ONLY the gatherers needed for the requested key set (targeted gather — no full sweeps).
---

# FactGatherer

<Signature
  code="interface FactGatherer {
	connectionKinds?: readonly ('ssh' | 'local' | 'network' | 'http')[];
	name: string;
	provides: readonly string[];
	gather(connection: Connection, opts?: GatherOptions): Promise<FactMap>;
}"
/>

<SourceLink href="/source/src/facts/types-ts/#L42" label="types.ts:42" />

A gatherer produces a SUBSET of facts for a connection. It declares the keys it can provide so the engine can run ONLY the gatherers needed for the requested key set (targeted gather — no full sweeps).

---

## Properties

<MemberHeading id="connectionkinds" depth="3" name="connectionKinds" sig="connectionKinds: readonly ('ssh' | 'local' | 'network' | 'http')[]" />

<MemberMeta badges="readonly" sourceHref="/source/src/facts/types-ts/#L52" sourceLabel="types.ts:52" />

Connection transports this gatherer is valid for. Omit to apply to every kind (the engine filters candidates by `connection.kind` at gather time, so a host only runs gatherers that suit its transport — Ansible-aligned).

<MemberHeading id="name" depth="3" name="name" sig="name: string" />

<MemberMeta badges="readonly" sourceHref="/source/src/facts/types-ts/#L44" sourceLabel="types.ts:44" />

Stable id, e.g. "os", "network", "service".

<MemberHeading id="provides" depth="3" name="provides" sig="provides: readonly string[]" />

<MemberMeta badges="readonly" sourceHref="/source/src/facts/types-ts/#L46" sourceLabel="types.ts:46" />

Fact keys this gatherer can produce.

## Methods

<MemberHeading
  id="gather"
  depth="3"
  name="gather"
  sig="gather(
	connection: Connection,
	opts?: GatherOptions,
): Promise<FactMap>"
/>

<MemberMeta badges="async" sourceHref="/source/src/facts/types-ts/#L54" sourceLabel="types.ts:54" />

Gather the facts this gatherer owns. May throw on transport failure.

**Parameters**

- `connection` ([Connection](/module/transport/connection))
- `opts` ([GatherOptions](/module/facts/gatheroptions), optional)

**Returns**

- `Promise<`[`FactMap`](/module/facts/factmap)`>`
