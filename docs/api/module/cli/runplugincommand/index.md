---
title: runPluginCommand
kind: function
longname: module:cli.runPluginCommand
---

# runPluginCommand

<Signature
  code="runPluginCommand(
	rest: string[],
	_flags: GlobalFlags,
): Promise<CliResult>"
/>

<SourceLink href="/source/src/cli/commands/plugin-ts/#L49" label="plugin.ts:49" />

**Modifiers:** `async`

**Parameters**

- `rest` (string\[]) — Args after `plugin` (subcommand + flags).
- `_flags` ([GlobalFlags](/module/cli/globalflags)) — Parsed global flags (unused: plugin output is human-stable).

**Returns**

- `Promise<`[`CliResult`](/module/cli/cliresult)`>` — A structured `CliResult` for the output plugin.
