---
title: runVarsCommand
kind: function
longname: module:cli.runVarsCommand
---

# runVarsCommand

<Signature
  code="runVarsCommand(
	sub: string | undefined,
	rest: string[],
	_flags: GlobalFlags,
): Promise<CliResult>"
/>

<SourceLink href="/source/src/cli/commands/vars-ts/#L30" label="vars.ts:30" />

**Modifiers:** `async`

**Parameters**

- `sub` (string | undefined) — Subcommand: `list` | `trace`.
- `rest` (string\[]) — Positional args (playbook path first).
- `_flags` ([GlobalFlags](/module/cli/globalflags))

**Returns**

- `Promise<`[`CliResult`](/module/cli/cliresult)`>` — A structured [CliResult](/module/cli/cliresult) rendered by the output plugin.
