---
title: mountWebhooks
kind: function
longname: module:orchestrator.mountWebhooks
description: Register POST /webhook + POST /api/run against the loose app surface.
---

# mountWebhooks

<Signature
  code="mountWebhooks(
	app: unknown,
	ctx: WebhookRouteContext,
	record: (method: string, path: string) => void,
): void"
/>

<SourceLink href="/source/src/orchestrator/webhooks-ts/#L59" label="webhooks.ts:59" />

Register POST /webhook + POST /api/run against the loose app surface.

**Parameters**

- `app` (unknown)
- `ctx` ([WebhookRouteContext](/module/orchestrator/webhookroutecontext))
- `record` ((method: string, path: string) => void)

**Returns**

- `void`
