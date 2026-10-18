---
title: getModuleSummary
kind: function
longname: module:modules.getModuleSummary
description: Look up the summary for a single module, falling back to a name-only entry when no metadata has been registered via {@link module:modules.setModuleMeta|setModuleMeta}.
---

# getModuleSummary

<Signature code="getModuleSummary(name: string): ModuleSummary" />

<SourceLink href="/source/src/modules/search-ts/#L51" label="search.ts:51" />

Look up the summary for a single module, falling back to a name-only entry when no metadata has been registered via [setModuleMeta](/module/modules/setmodulemeta).

**Parameters**

- `name` (string) — Module name as registered via `registerModule`.

**Returns**

- [`ModuleSummary`](/module/modules/modulesummary) — The registered [ModuleSummary](/module/modules/modulesummary), or a name/description-only stub.
