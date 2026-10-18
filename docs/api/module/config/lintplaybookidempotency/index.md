---
title: lintPlaybookIdempotency
kind: function
longname: module:config.lintPlaybookIdempotency
description: Inspect a normalized playbook for unguarded shell/command tasks and return human-readable warnings. Never throws — callers decide how to surface them.
---

# lintPlaybookIdempotency

<Signature
  code="lintPlaybookIdempotency(
	pb: NormalizedPlaybook,
): IdempotencyWarning[]"
/>

<SourceLink href="/source/src/config/loader-ts/#L92" label="loader.ts:92" />

Inspect a normalized playbook for unguarded shell/command tasks and return human-readable warnings. Never throws — callers decide how to surface them.

**Parameters**

- `pb` ([NormalizedPlaybook](/module/config/normalizedplaybook)) — Normalized playbook model.

**Returns**

- [`IdempotencyWarning`](/module/config/idempotencywarning)`[]` — Zero or more idempotency warnings.
