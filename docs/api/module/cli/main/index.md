---
title: main
kind: function
longname: module:cli.main
---

# main

<Signature code="main(argv: string[]): Promise<number>" />

<SourceLink href="/source/src/cli/index-ts/#L188" label="index.ts:188" />

**Modifiers:** `async`

**Parameters**

- `argv` (string\[]) — Command-line arguments (runtime argv: Bun.argv or process.argv); slice(2) drops node/script paths.

**Returns**

- `Promise<number>` — Process exit code (0 ok, 1 runtime error, 2 usage/validation error).
