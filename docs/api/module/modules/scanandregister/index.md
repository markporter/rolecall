---
title: scanAndRegister
kind: function
longname: module:modules.scanAndRegister
description: Scan a project root, build the resolution table, and eagerly load every discovered modules plugin exactly once. Scanned modules are NOT written into the bare registry (no silent clobber); those declaring facts are wired into the fact engine under their FQCN. A single bad plugin is warned and skipped so one broken file never aborts startup.
---

# scanAndRegister

<Signature code="scanAndRegister(root: string): Promise<void>" />

<SourceLink href="/source/src/modules/resolver-ts/#L195" label="resolver.ts:195" />

**Modifiers:** `async`

Scan a project root, build the resolution table, and eagerly load every discovered `modules` plugin exactly once. Scanned modules are NOT written into the bare registry (no silent clobber); those declaring `facts` are wired into the fact engine under their FQCN. A single bad plugin is warned and skipped so one broken file never aborts startup.

**Parameters**

- `root` (string) — Project root to scan (resolved against cwd when relative).

**Returns**

- `Promise<void>`
