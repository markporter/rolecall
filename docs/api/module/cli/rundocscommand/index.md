---
title: runDocsCommand
kind: function
longname: module:cli.runDocsCommand
---

# runDocsCommand

<Signature
  code="runDocsCommand(
	sub: string | undefined,
	rest: string[],
	_flags: GlobalFlags,
): Promise<CliResult>"
/>

<SourceLink href="/source/src/cli/commands/docs-ts/#L7" label="docs.ts:7" />

**Modifiers:** `async`

**Parameters**

- `sub` (string | undefined) — Subcommand token; one of "search" | "modules".
- `rest` (string\[]) — Positional args; rest\[0] is the query/filter term for the chosen subcommand.
- `_flags` ([GlobalFlags](/module/cli/globalflags)) — Global flags (unused for docs; output selection is handled downstream by the output plugin).

**Returns**

- `Promise<`[`CliResult`](/module/cli/cliresult)`>` — A DocsSearchResult or DocsModulesResult rendered by the output plugin.
