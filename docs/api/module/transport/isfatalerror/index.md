---
title: isFatalError
kind: function
longname: module:transport.isFatalError
description: Errors that must NOT be retried — retrying them is futile and wastes the retry budget. Covers auth failures, permission denials, host-key mismatches, and unparseable credentials. Transient network blips (timeouts, resets, refusals during a rolling restart) are deliberately NOT in this set so they are retried.
---

# isFatalError

<Signature code="isFatalError(err: unknown): boolean" />

<SourceLink href="/source/src/transport/connection-ts/#L204" label="connection.ts:204" />

Errors that must NOT be retried — retrying them is futile and wastes the retry budget. Covers auth failures, permission denials, host-key mismatches, and unparseable credentials. Transient network blips (timeouts, resets, refusals during a rolling restart) are deliberately NOT in this set so they are retried.

**Parameters**

- `err` (unknown)

**Returns**

- `boolean`
