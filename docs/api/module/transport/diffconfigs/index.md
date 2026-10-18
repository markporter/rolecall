---
title: diffConfigs
kind: function
longname: module:transport.diffConfigs
description: Diff a candidate config against the device running config. old is running, new is candidate, so added = candidate-only lines.
---

# diffConfigs

<Signature code="diffConfigs(candidate: string, running: string): ConfigDiff" />

<SourceLink href="/source/src/transport/diff-ts/#L41" label="diff.ts:41" />

Diff a candidate config against the device running config. `old` is running, `new` is candidate, so `added` = candidate-only lines.

**Parameters**

- `candidate` (string)
- `running` (string)

**Returns**

- [`ConfigDiff`](/module/transport/configdiff)
