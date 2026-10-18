---
title: detectInventoryFormat
kind: function
longname: module:config.detectInventoryFormat
---

# detectInventoryFormat

<Signature
  code="detectInventoryFormat(
	text: string,
	filename: string,
): InventoryFormat"
/>

<SourceLink href="/source/src/config/loader-ts/#L760" label="loader.ts:760" />

**Parameters**

- `text` (string) — Raw inventory text.
- `filename` (string, default: "\\"\\"") — Optional source path; only its extension is consulted as a hint.

**Returns**

- [`InventoryFormat`](/module/config/inventoryformat) — The detected [InventoryFormat](/module/config/inventoryformat).
