---
title: mountRoutes
kind: function
longname: module:orchestrator.mountRoutes
description: Register every resource route from ROUTE_DEFINITIONS plus the terminal 404/405/error middlewares. Each def's methods are recorded into the known-path registry consumed by makeNotFoundHandler() so unknown/disallowed requests still resolve correctly.
---

# mountRoutes

<Signature code="mountRoutes(app: object, ctx: RouteContext): void" />

<SourceLink href="/source/src/orchestrator/routes-ts/#L570" label="routes.ts:570" />

Register every resource route from ROUTE_DEFINITIONS plus the terminal 404/405/error middlewares. Each def's methods are recorded into the known-path registry consumed by makeNotFoundHandler() so unknown/disallowed requests still resolve correctly.

**Parameters**

- `app` (object)
- `ctx` ([RouteContext](/module/orchestrator/routecontext))

**Returns**

- `void`
