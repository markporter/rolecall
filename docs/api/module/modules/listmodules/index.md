---
title: listModules
kind: function
longname: module:modules.listModules
description: "Sorted list of registered module names (deterministic ordering). With ListModulesOptions.specifiers, each relative user module specifier (e.g. \"./mod.ts\" ) is resolved to its absolute import location under the source root via ProjectSource.resolveImportablePath; bare names pass through unchanged. This is how the VFS reaches user modules ( module: ./path ), not just playbooks/inventory. Backward-compatible: called with no arguments it returns exactly [...registry.keys()].sort() — identical to before."
---

# listModules

<Signature code="listModules(options?: ListModulesOptions): string[]" />

<SourceLink href="/source/src/executor/module-ts/#L161" label="module.ts:161" />

Sorted list of registered module names (deterministic ordering). With ListModulesOptions.specifiers, each relative user module specifier (e.g. `"./mod.ts"`) is resolved to its absolute import location under the source root via ProjectSource.resolveImportablePath; bare names pass through unchanged. This is how the VFS reaches user modules (`module: ./path`), not just playbooks/inventory. Backward-compatible: called with no arguments it returns exactly `[...registry.keys()].sort()` — identical to before.

**Parameters**

- `options` (ListModulesOptions, optional) — Optional VFS + user-authored specifiers to resolve.

**Returns**

- `string[]` — Sorted registered names, extended with any resolved relative specifiers.
