---
title: resolveDirectoryVars
kind: function
longname: module:config.resolveDirectoryVars
description: "Discover directory-adjacent group_vars/ and host_vars/ var files next to an inventory and parse them through the VFS seam. Group/host names are derived from the file name with its extension stripped ( group_vars/web.yaml -> group web ). Discovery is graceful: a missing directory raises no error and yields an empty map for that layer, so inventories without these directories behave exactly as before."
---

# resolveDirectoryVars

<Signature
  code="resolveDirectoryVars(
	inventoryPath: string,
	source: ProjectSource,
): Promise<DirectoryVars>"
/>

<SourceLink href="/source/src/config/loader-ts/#L830" label="loader.ts:830" />

**Modifiers:** `async`

Discover directory-adjacent `group_vars/` and `host_vars/` var files next to an inventory and parse them through the VFS seam. Group/host names are derived from the file name with its extension stripped (`group_vars/web.yaml` -> group `web`). Discovery is graceful: a missing directory raises no error and yields an empty map for that layer, so inventories without these directories behave exactly as before.

**Parameters**

- `inventoryPath` (string) — Inventory file path (used only to anchor discovery; the actual scan is performed under `source.root`, which callers root at `dirname(inventoryPath)`).
- `source` (ProjectSource) — Project VFS rooted at the inventory file's directory.

**Returns**

- `Promise<`[`DirectoryVars`](/module/config/directoryvars)`>` — Parsed group/host var maps keyed by group/host name.
