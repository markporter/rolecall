---
title: registerAllModules
kind: function
longname: module:modules.registerAllModules
description: Register all built-in modules with the executor registry (idempotent — safe to call repeatedly) and auto-collect their search metadata. Each module carries its summary on a meta property; the guarded blocks below copy it into the search metadata map so searchModules / getModuleSummary cover every module.
---

# registerAllModules

<Signature code="registerAllModules(): void" />

<SourceLink href="/source/src/modules/builtins/index-ts/#L82" label="index.ts:82" />

Register all built-in modules with the executor registry (idempotent — safe to call repeatedly) and auto-collect their search metadata. Each module carries its summary on a `meta` property; the guarded blocks below copy it into the search metadata map so `searchModules`/`getModuleSummary` cover every module.

**Returns**

- `void`
