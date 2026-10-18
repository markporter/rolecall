---
title: renderOutput
kind: function
longname: module:cli.renderOutput
---

# renderOutput

<Signature code="renderOutput(name: string, data: CliResult): string" />

<SourceLink href="/source/src/cli/output-ts/#L47" label="output.ts:47" />

**Parameters**

- `name` (string) — Registered plugin name (@see listOutputPlugins).
- `data` ([CliResult](/module/cli/cliresult)) — Result payload to render.

**Returns**

- `string` — Rendered string; throws Error if the plugin name is unknown.
