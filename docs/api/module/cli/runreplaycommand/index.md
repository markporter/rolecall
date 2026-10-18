---
title: runReplayCommand
kind: function
longname: module:cli.runReplayCommand
description: rolecall run replay &#x3C;id> — load a stored run + its trace ledger and re-emit it.
---

# runReplayCommand

<Signature
  code="runReplayCommand(
	sub: string | undefined,
	rest: string[],
	_flags: GlobalFlags,
): Promise<CliResult>"
/>

<SourceLink href="/source/src/cli/commands/run-ts/#L70" label="run.ts:70" />

**Modifiers:** `async`

`rolecall run replay <id>` — load a stored run + its trace ledger and re-emit it.

**Parameters**

- `sub` (string | undefined) — Must be "replay".
- `rest` (string\[]) — `[id]` — the run identifier to replay.
- `_flags` ([GlobalFlags](/module/cli/globalflags))

**Returns**

- `Promise<`[`CliResult`](/module/cli/cliresult)`>`
