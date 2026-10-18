---
title: parseExpr
kind: function
longname: module:orchestrator.parseExpr
description: Parse expr , throwing Error('invalid cron expression "&#x3C;expr>" …') on failure.
---

# parseExpr

<Signature code="parseExpr(expr: unknown): ParsedCron" />

<SourceLink href="/source/src/orchestrator/cron-ts/#L106" label="cron.ts:106" />

Parse `expr`, throwing `Error('invalid cron expression "<expr>" …')` on failure.

**Parameters**

- `expr` (unknown)

**Returns**

- [`ParsedCron`](/module/orchestrator/parsedcron)
