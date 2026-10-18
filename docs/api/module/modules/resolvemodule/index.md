---
title: resolveModule
kind: function
longname: module:modules.resolveModule
description: "Resolve a module reference to a {@link module:modules.ResolveResult|ResolveResult}. Resolution order (modules type): rolecall.builtin.* / ansible.builtin.* → strip prefix, bare builtin lookup. A spec containing . is treated as an FQCN → table lookup. A bare spec → reserved builtin/registry name, then an unambiguous bare alias, then an ambiguous result when the bare name maps to >1 FQCN, else notFound . The bare registry ( getModule ) is consulted for bare specifiers AND as the fallback for dotted specifiers the scan table does not contain, so resolution matches the pre-0014 dispatch for registered modules regardless of whether scanAndRegister has run."
---

# resolveModule

<Signature code="resolveModule(spec: string): ResolveResult" />

<SourceLink href="/source/src/modules/resolver-ts/#L83" label="resolver.ts:83" />

Resolve a module reference to a [ResolveResult](/module/modules/resolveresult).

Resolution order (modules type):

1. `rolecall.builtin.*` / `ansible.builtin.*` → strip prefix, bare builtin lookup.
1. A spec containing `.` is treated as an FQCN → table lookup.
1. A bare spec → reserved builtin/registry name, then an unambiguous bare alias, then an `ambiguous` result when the bare name maps to >1 FQCN, else `notFound`.

The bare registry (`getModule`) is consulted for bare specifiers AND as the fallback for dotted specifiers the scan table does not contain, so resolution matches the pre-0014 dispatch for registered modules regardless of whether `scanAndRegister` has run.

**Parameters**

- `spec` (string) — The module reference from a task (`module:` field).

**Returns**

- [`ResolveResult`](/module/modules/resolveresult) — A [ResolveResult](/module/modules/resolveresult) describing the outcome.
