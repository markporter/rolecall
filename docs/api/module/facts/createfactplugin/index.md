---
title: createFactPlugin
kind: function
longname: module:facts.createFactPlugin
description: "Helper to build a user FactPlugin from one or more gatherers. Users add custom fact sources without touching the engine: const plugin = createFactPlugin(\"myfacts\", [{ name: \"tz\", provides: [\"timezone\"], gather: async (c) => ({ timezone: (await c.exec(\"cat /etc/timezone\")).stdout.trim() }), }]); engine.registerPlugin(plugin);"
---

# createFactPlugin

<Signature
  code="createFactPlugin(
	name: string,
	gatherers: readonly FactGatherer[],
): FactPlugin"
/>

<SourceLink href="/source/src/facts/gatherers-ts/#L91" label="gatherers.ts:91" />

Helper to build a user FactPlugin from one or more gatherers. Users add custom fact sources without touching the engine:

const plugin = createFactPlugin("myfacts", \[{ name: "tz", provides: \["timezone"], gather: async (c) => ({ timezone: (await c.exec("cat /etc/timezone")).stdout.trim() }), }]); engine.registerPlugin(plugin);

**Parameters**

- `name` (string)
- `gatherers` (readonly [FactGatherer](/module/facts/factgatherer)\[])

**Returns**

- [`FactPlugin`](/module/facts/factplugin)
