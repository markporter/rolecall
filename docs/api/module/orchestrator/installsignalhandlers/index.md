---
title: installSignalHandlers
kind: function
longname: module:orchestrator.installSignalHandlers
description: Register SIGINT/SIGTERM listeners once on the handle. Idempotent.
---

# installSignalHandlers

<Signature
  code="installSignalHandlers(
	handle: ServerHandle,
	opts: ShutdownOptions,
): void"
/>

<SourceLink href="/source/src/orchestrator/shutdown-ts/#L15" label="shutdown.ts:15" />

Register SIGINT/SIGTERM listeners once on the handle. Idempotent.

**Parameters**

- `handle` ([ServerHandle](/module/orchestrator/serverhandle))
- `opts` ([ShutdownOptions](/module/orchestrator/shutdownoptions), default: "{}")

**Returns**

- `void`
