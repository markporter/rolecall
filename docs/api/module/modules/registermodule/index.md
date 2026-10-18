---
title: registerModule
kind: function
longname: module:modules.registerModule
description: Register (or overwrite) a module under its name. If the module declares {@link module:modules.Module#facts|Module.facts} and/or {@link module:modules.Module#factGatherer|Module.factGatherer}, it is also registered as a fact plugin so its facts are gathered by the engine and validate under var_strict .
---

# registerModule

<Signature code="registerModule(mod: Module): void" />

<SourceLink href="/source/src/executor/module-ts/#L113" label="module.ts:113" />

Register (or overwrite) a module under its name. If the module declares [Module.facts](/module/modules/module#facts) and/or [Module.factGatherer](/module/modules/module#factgatherer), it is also registered as a fact plugin so its facts are gathered by the engine and validate under `var_strict`.

**Parameters**

- `mod` ([Module](/module/modules/module)) — The module to register.

**Returns**

- `void`
