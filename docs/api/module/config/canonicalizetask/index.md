---
title: canonicalizeTask
kind: function
longname: module:config.canonicalizeTask
---

# canonicalizeTask

<Signature code="canonicalizeTask(raw: unknown): unknown" />

<SourceLink href="/source/src/config/schema-ts/#L144" label="schema.ts:144" />

**Parameters**

- `raw` (unknown) — The raw task object parsed from YAML.

**Returns**

- `unknown` — The canonical explicit task, or `raw` unchanged when no safe rewrite applies.
