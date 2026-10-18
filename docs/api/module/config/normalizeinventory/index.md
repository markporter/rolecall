---
title: normalizeInventory
kind: function
longname: module:config.normalizeInventory
description: Normalize a validated RawInventory into grouped, vars-defaulted canonical form, preserving child-group names and per-host vars when present.
---

# normalizeInventory

<Signature
  code="normalizeInventory(
	raw: { groups: Record<string, { children?: string[]; hosts: string[]; vars?: Record<string, unknown> }>; host_vars?: Record<string, Record<string, unknown>> },
): NormalizedInventory"
/>

<SourceLink href="/source/src/config/schema-ts/#L476" label="schema.ts:476" />

Normalize a validated RawInventory into grouped, vars-defaulted canonical form, preserving child-group names and per-host vars when present.

**Parameters**

- `raw` ({ groups: Record\<string, { children?: string\[]; hosts: string\[]; vars?: Record\<string, unknown> }>; host_vars?: Record\<string, Record\<string, unknown>> })

**Properties**

- `groups` (Record\<string, { children?: string\[]; hosts: string\[]; vars?: Record\<string, unknown> }>)
- `host_vars` (Record\<string, Record\<string, unknown>>, optional) — Per-host variable maps, keyed by hostname (highest precedence layer).

**Returns**

- [`NormalizedInventory`](/module/config/normalizedinventory)
