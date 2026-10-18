---
title: loadInventoryFile
kind: function
longname: module:config.loadInventoryFile
description: "Read an inventory file and return its normalized form, auto-detecting the source format (native groups: YAML, Ansible INI, or Ansible all: -rooted YAML) via {@link module:config.detectInventoryFormat|detectInventoryFormat}. Reads through the VFS seam so a non-disk ProjectSource can serve inventories unchanged. Backward-compatible: with no source the default (cwd) reads exactly as before."
---

# loadInventoryFile

<Signature
  code="loadInventoryFile(
	path: string,
	source: ProjectSource,
): Promise<NormalizedInventory>"
/>

<SourceLink href="/source/src/config/loader-ts/#L869" label="loader.ts:869" />

**Modifiers:** `async`

Read an inventory file and return its normalized form, auto-detecting the source format (native `groups:` YAML, Ansible INI, or Ansible `all:`-rooted YAML) via [detectInventoryFormat](/module/config/detectinventoryformat). Reads through the VFS seam so a non-disk ProjectSource can serve inventories unchanged. Backward-compatible: with no `source` the default (cwd) reads exactly as before.

**Parameters**

- `path` (string) — Path to the inventory file (relative paths resolve against the source root).
- `source` (ProjectSource, default: "...") — Optional project VFS; defaults to reading from the current working directory.

**Returns**

- `Promise<`[`NormalizedInventory`](/module/config/normalizedinventory)`>` — The normalized inventory.
