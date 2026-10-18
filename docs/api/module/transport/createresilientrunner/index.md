---
title: createResilientRunner
kind: function
longname: module:transport.createResilientRunner
description: "Build a runner that wraps a raw per-command executor with: bounded concurrency (p-limit) so callers can fan out safely, a hard timeout via AbortSignal (rejects with TimeoutError), exponential backoff + jitter retry (p-retry) that bails immediately on fatal/auth errors (see isFatalError). The returned runner takes the core executor and optional per-call ExecOptions (which may override timeoutMs and supply an AbortSignal)."
---

# createResilientRunner

<Signature
  code="createResilientRunner(
	config: ResilienceConfig,
): (core: CoreExec, options?: ExecOptions) => Promise<ExecResult>"
/>

<SourceLink href="/source/src/transport/connection-ts/#L239" label="connection.ts:239" />

Build a runner that wraps a raw per-command executor with:

- bounded concurrency (p-limit) so callers can fan out safely,
- a hard timeout via AbortSignal (rejects with TimeoutError),
- exponential backoff + jitter retry (p-retry) that bails immediately on fatal/auth errors (see isFatalError).

The returned runner takes the core executor and optional per-call ExecOptions (which may override timeoutMs and supply an AbortSignal).

**Parameters**

- `config` ([ResilienceConfig](/module/transport/resilienceconfig))

**Returns**

- `(core: `[`CoreExec`](/module/transport/coreexec)`, options?: `[`ExecOptions`](/module/transport/execoptions)`) => Promise<`[`ExecResult`](/module/transport/execresult)`>`
