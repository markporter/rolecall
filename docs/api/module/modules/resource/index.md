---
title: resource
kind: function
longname: module:modules.resource
description: Build an idempotent-by-default Module from a declarative describe/converge pair. The returned object satisfies BOTH Module (via run ) and CheckableModule (via check ), so the idempotency policy detects and uses check automatically.
---

# resource

<Signature code="resource(opts: ResourceOptions): Module & CheckableModule" />

<SourceLink href="/source/src/modules/resource-ts/#L58" label="resource.ts:58" />

Build an idempotent-by-default Module from a declarative describe/converge pair. The returned object satisfies BOTH `Module` (via `run`) and `CheckableModule` (via `check`), so the idempotency policy detects and uses `check` automatically.

**Parameters**

- `opts` ([ResourceOptions](/module/modules/resourceoptions)) — The describe/converge pair (plus optional name).

**Returns**

- [`Module`](/module/modules/module)` & CheckableModule` — A Module & CheckableModule ready to `registerModule`.
