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
	childCli?: string[];
	childTimeoutMs?: number;
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

<SourceLink href="/source/src/orchestrator/types-ts/#L127" label="types.ts:127" />

Options accepted by createServer().

---

## Properties

<MemberHeading id="authtoken" depth="3" name="authToken" sig="authToken: string" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L144" sourceLabel="types.ts:144" />

Optional single-token Bearer guard for run-trigger endpoints (webhook/REST). When set, requests must send `Authorization: Bearer <token>` else 401. Placeholder ONLY — RBAC/multi-user is deferred. Unset => open.

<MemberHeading id="childcli" depth="3" name="childCli" sig="childCli: string[]" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L139" sourceLabel="types.ts:139" />

Override the command used to fork playbook runs (default: resolve the current CLI entrypoint).

<MemberHeading id="childtimeoutms" depth="3" name="childTimeoutMs" sig="childTimeoutMs: number" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L141" sourceLabel="types.ts:141" />

Hard timeout for a forked run before SIGTERM, in ms (default 15 minutes).

<MemberHeading id="fleet" depth="3" name="fleet" sig="fleet: TargetDescriptor[]" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L133" sourceLabel="types.ts:133" />

Initial fleet targets. Register more via an admin endpoint later.

<MemberHeading id="hostname" depth="3" name="hostname" sig="hostname: string" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L129" sourceLabel="types.ts:129" />

<MemberHeading id="nosignalhandlers" depth="3" name="noSignalHandlers" sig="noSignalHandlers: boolean" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L137" sourceLabel="types.ts:137" />

Disable signal-handler installation (used by tests that close manually). Default false.

<MemberHeading id="port" depth="3" name="port" sig="port: number" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L128" sourceLabel="types.ts:128" />

<MemberHeading id="scheduler" depth="3" name="scheduler" sig="scheduler: SchedulerApi" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L134" sourceLabel="types.ts:134" />

<MemberHeading id="store" depth="3" name="store" sig="store: Store" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L131" sourceLabel="types.ts:131" />

Durable registry (Task 19 store). Opened internally when omitted.

<MemberHeading id="tickms" depth="3" name="tickMs" sig="tickMs: number" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L135" sourceLabel="types.ts:135" />

<MemberHeading id="uidist" depth="3" name="uiDist" sig="uiDist: string" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L146" sourceLabel="types.ts:146" />

Directory whose contents are served as a pluggable static UI (Todo 23). UNSET => zero-build mode (GET "/" stays health JSON). SET + exists => express.static(dir); SET + missing => deterministic plain-text guidance.
