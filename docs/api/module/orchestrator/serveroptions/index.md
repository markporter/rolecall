---
title: ServerOptions
kind: interface
longname: module:orchestrator.ServerOptions
description: Options accepted by createServer().
---

# ServerOptions

<Signature
  code="interface ServerOptions {
	authToken?: string;
	fleet?: TargetDescriptor[];
	hostname?: string;
	noSignalHandlers?: boolean;
	port?: number;
	scheduler?: SchedulerApi;
	store?: Store;
	tickMs?: number;
	uiDist?: string;
}"
/>

<SourceLink href="/source/src/orchestrator/types-ts/#L119" label="types.ts:119" />

Options accepted by createServer().

---

## Properties

<MemberHeading id="authtoken" depth="3" name="authToken" sig="authToken: string" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L132" sourceLabel="types.ts:132" />

Optional single-token Bearer guard for run-trigger endpoints (webhook/REST). When set, requests must send `Authorization: Bearer <token>` else 401. Placeholder ONLY — RBAC/multi-user is deferred. Unset => open.

<MemberHeading id="fleet" depth="3" name="fleet" sig="fleet: TargetDescriptor[]" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L125" sourceLabel="types.ts:125" />

Initial fleet targets. Register more via an admin endpoint later.

<MemberHeading id="hostname" depth="3" name="hostname" sig="hostname: string" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L121" sourceLabel="types.ts:121" />

<MemberHeading id="nosignalhandlers" depth="3" name="noSignalHandlers" sig="noSignalHandlers: boolean" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L129" sourceLabel="types.ts:129" />

Disable signal-handler installation (used by tests that close manually). Default false.

<MemberHeading id="port" depth="3" name="port" sig="port: number" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L120" sourceLabel="types.ts:120" />

<MemberHeading id="scheduler" depth="3" name="scheduler" sig="scheduler: SchedulerApi" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L126" sourceLabel="types.ts:126" />

<MemberHeading id="store" depth="3" name="store" sig="store: Store" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L123" sourceLabel="types.ts:123" />

Durable registry (Task 19 store). Opened internally when omitted.

<MemberHeading id="tickms" depth="3" name="tickMs" sig="tickMs: number" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L127" sourceLabel="types.ts:127" />

<MemberHeading id="uidist" depth="3" name="uiDist" sig="uiDist: string" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L134" sourceLabel="types.ts:134" />

Directory whose contents are served as a pluggable static UI (Todo 23). UNSET => zero-build mode (GET "/" stays health JSON). SET + exists => express.static(dir); SET + missing => deterministic plain-text guidance.
