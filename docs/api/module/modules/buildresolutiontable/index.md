---
title: buildResolutionTable
kind: function
longname: module:modules.buildResolutionTable
description: Build the resolution tables from scanned entries. Names that collide with a reserved bare name ( builtinNames ) are excluded from the bare-alias map so the builtin keeps the bare alias; the user plugin remains reachable only by FQCN. Ambiguity (a bare name mapping to >1 FQCN) is recorded but NOT an error here — it is surfaced at resolve time.
---

# buildResolutionTable

<Signature
  code="buildResolutionTable(
	entries: PluginScanEntry[],
	builtinNames: Set<string>,
): void"
/>

<SourceLink href="/source/src/modules/resolver-ts/#L143" label="resolver.ts:143" />

Build the resolution tables from scanned entries. Names that collide with a reserved bare name (`builtinNames`) are excluded from the bare-alias map so the builtin keeps the bare alias; the user plugin remains reachable only by FQCN. Ambiguity (a bare name mapping to >1 FQCN) is recorded but NOT an error here — it is surfaced at resolve time.

**Parameters**

- `entries` ([PluginScanEntry](/module/modules/pluginscanentry)\[]) — Scanned plugin entries (pure FS; modules are attached separately).
- `builtinNames` (Set\<string>) — Reserved bare names that win the bare alias (builtins + registered plugins).

**Returns**

- `void`
