---
title: startServe
kind: function
longname: module:orchestrator.startServe
description: "CLI entrypoint: parse --port/--host, boot the server, and block until signalled."
---

# startServe

<Signature
  code="startServe(
	argv?: string[],
	opts: Partial<ServerOptions>,
): Promise<number>"
/>

<SourceLink href="/source/src/orchestrator/serve-ts/#L103" label="serve.ts:103" />

**Modifiers:** `async`

CLI entrypoint: parse --port/--host, boot the server, and block until signalled.

**Parameters**

- `argv` (string\[], optional) — Command-line arguments (defaults to process.argv.slice(2)).
- `opts` (Partial\<[ServerOptions](/module/orchestrator/serveroptions)>, default: "{}") — Optional overrides forwarded to createServer() (e.g. noSignalHandlers for tests). Defaults empty so normal invocations are unaffected.

**Returns**

- `Promise<number>` — Exit code once a termination signal triggers graceful shutdown (always 0 today).
