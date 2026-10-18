---
title: searchModules
kind: function
longname: module:modules.searchModules
description: Filter all registered modules by a substring match against name OR description (case-insensitive). An empty/whitespace term returns every module.
---

# searchModules

<Signature code="searchModules(term: string): ModuleSummary[]" />

<SourceLink href="/source/src/modules/search-ts/#L61" label="search.ts:61" />

Filter all registered modules by a substring match against name OR description (case-insensitive). An empty/whitespace `term` returns every module.

**Parameters**

- `term` (string) — Search term; matched as a substring of name or description.

**Returns**

- [`ModuleSummary`](/module/modules/modulesummary)`[]` — Serializable summaries, sorted by name for deterministic output.
