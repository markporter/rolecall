---
title: RouteContext
kind: interface
longname: module:orchestrator.RouteContext
description: "Context injected into every route handler: engine plus optional store, scheduler, auth token."
---

# RouteContext

<Signature
  code="interface RouteContext {
	authToken?: string;
	engine: Engine;
	scheduler?: SchedulerApi;
	store?: Store;
}"
/>

<SourceLink href="/source/src/orchestrator/routes-ts/#L35" label="routes.ts:35" />

Context injected into every route handler: engine plus optional store, scheduler, auth token.

---

## Properties

<MemberHeading id="authtoken" depth="3" name="authToken" sig="authToken: string" />

<MemberMeta sourceHref="/source/src/orchestrator/routes-ts/#L40" sourceLabel="routes.ts:40" />

Optional single-token Bearer guard for webhook/REST triggers (Todo 21).

<MemberHeading id="engine" depth="3" name="engine" sig="engine: Engine" />

<MemberMeta sourceHref="/source/src/orchestrator/routes-ts/#L36" sourceLabel="routes.ts:36" />

<MemberHeading id="scheduler" depth="3" name="scheduler" sig="scheduler: SchedulerApi" />

<MemberMeta sourceHref="/source/src/orchestrator/routes-ts/#L38" sourceLabel="routes.ts:38" />

<MemberHeading id="store" depth="3" name="store" sig="store: Store" />

<MemberMeta sourceHref="/source/src/orchestrator/routes-ts/#L37" sourceLabel="routes.ts:37" />
