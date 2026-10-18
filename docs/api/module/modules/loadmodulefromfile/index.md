---
title: loadModuleFromFile
kind: function
longname: module:modules.loadModuleFromFile
---

# loadModuleFromFile

<Signature code="loadModuleFromFile(filePath: string): Promise<Module>" />

<SourceLink href="/source/src/modules/loader-ts/#L122" label="loader.ts:122" />

**Modifiers:** `async`

**Parameters**

- `filePath` (string) — Path to the module, resolved against cwd.

**Returns**

- `Promise<`[`Module`](/module/modules/module)`>` — The registered Module instance (also reachable later via getModule(name)). Throws a readable error on load failure or invalid export shape.
