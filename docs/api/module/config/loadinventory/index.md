---
title: loadInventory
kind: function
longname: module:config.loadInventory
---

# loadInventory

<Signature
  code="loadInventory(
	text: string,
	filename: string,
): NormalizedInventory"
/>

<SourceLink href="/source/src/config/loader-ts/#L795" label="loader.ts:795" />

**Parameters**

- `text` (string) — Raw inventory text (native YAML, Ansible INI, or Ansible YAML).
- `filename` (string, default: "\\"\\"") — Optional source path; its extension is a detection hint.

**Returns**

- [`NormalizedInventory`](/module/config/normalizedinventory) — The normalized inventory.

**Throws**

- When native YAML fails schema validation.
- When an Ansible inventory is malformed.
