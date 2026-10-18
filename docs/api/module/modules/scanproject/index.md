---
title: scanProject
kind: function
longname: module:modules.scanProject
description: Scan a project root for plugins. Enumerates every plugins/&#x3C;type>/&#x3C;namespace>/&#x3C;name> location (including collections/&#x3C;org>/&#x3C;coll>/plugins/... ) and derives each entry's FQCN from its path. Pure filesystem — performs no module loading.
---

# scanProject

<Signature
  code="scanProject(
	opts: { root: string; types?: PluginType[] },
): PluginScanEntry[]"
/>

<SourceLink href="/source/src/modules/scanner-ts/#L106" label="scanner.ts:106" />

Scan a project root for plugins. Enumerates every `plugins/<type>/<namespace>/<name>` location (including `collections/<org>/<coll>/plugins/...`) and derives each entry's FQCN from its path. Pure filesystem — performs no module loading.

**Parameters**

- `opts` ({ root: string; types?: [PluginType](/module/modules/plugintype)\[] })

**Properties**

- `root` (string) — Project root to scan (resolved against cwd when relative).
- `types` ([PluginType](/module/modules/plugintype)\[], optional) — Optional type filter; when omitted all five types are scanned.

**Returns**

- [`PluginScanEntry`](/module/modules/pluginscanentry)`[]` — Discovered plugin entries (FQCNs normalized to posix).
