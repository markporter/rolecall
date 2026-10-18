---
title: setModuleMeta
kind: function
longname: module:modules.setModuleMeta
description: Attach metadata to a registered module name (idempotent upsert).
---

# setModuleMeta

<Signature
  code="setModuleMeta(
	name: string,
	summary: Partial<ModuleSummary>,
): void"
/>

<SourceLink href="/source/src/modules/search-ts/#L40" label="search.ts:40" />

Attach metadata to a registered module name (idempotent upsert).

**Parameters**

- `name` (string) — Module name as registered via `registerModule`.
- `summary` (Partial\<[ModuleSummary](/module/modules/modulesummary)>) — Partial summary merged over any prior metadata.

**Returns**

- `void`
