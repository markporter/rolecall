---
title: TargetDescriptor
kind: interface
longname: module:orchestrator.TargetDescriptor
description: A registered, reachable target (simulated via Task-17 factories or real).
---

# TargetDescriptor

<Signature
  code="interface TargetDescriptor {
	auth?: { pass?: string; token?: string; type: 'basic' | 'token'; user?: string };
	credentials?: Credentials;
	device?: NetworkDeviceSimHandle;
	host?: string;
	kind: TransportKind;
	knownHostsPath?: string;
	name: string;
	port?: number;
	retry?: Partial<RetryConfig>;
	shell?: string;
	timeoutMs?: number;
	url?: string;
	user?: string;
}"
/>

<SourceLink href="/source/src/orchestrator/types-ts/#L28" label="types.ts:28" />

A registered, reachable target (simulated via Task-17 factories or real).

---

## Properties

<MemberHeading id="auth" depth="3" name="auth" sig="auth: { pass?: string; token?: string; type: 'basic' | 'token'; user?: string }" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L43" sourceLabel="types.ts:43" />

**Properties**

- `pass` (string, optional)
- `token` (string, optional)
- `type` ("basic" | "token")
- `user` (string, optional)

<MemberHeading id="credentials" depth="3" name="credentials" sig="credentials: Credentials" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L35" sourceLabel="types.ts:35" />

<MemberHeading id="device" depth="3" name="device" sig="device: NetworkDeviceSimHandle" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L45" sourceLabel="types.ts:45" />

<MemberHeading id="host" depth="3" name="host" sig="host: string" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L32" sourceLabel="types.ts:32" />

<MemberHeading id="kind" depth="3" name="kind" sig="kind: TransportKind" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L30" sourceLabel="types.ts:30" />

<MemberHeading id="knownhostspath" depth="3" name="knownHostsPath" sig="knownHostsPath: string" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L37" sourceLabel="types.ts:37" />

<MemberHeading id="name" depth="3" name="name" sig="name: string" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L29" sourceLabel="types.ts:29" />

<MemberHeading id="port" depth="3" name="port" sig="port: number" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L33" sourceLabel="types.ts:33" />

<MemberHeading id="retry" depth="3" name="retry" sig="retry: Partial<RetryConfig>" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L40" sourceLabel="types.ts:40" />

<MemberHeading id="shell" depth="3" name="shell" sig="shell: string" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L38" sourceLabel="types.ts:38" />

<MemberHeading id="timeoutms" depth="3" name="timeoutMs" sig="timeoutMs: number" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L39" sourceLabel="types.ts:39" />

<MemberHeading id="url" depth="3" name="url" sig="url: string" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L42" sourceLabel="types.ts:42" />

<MemberHeading id="user" depth="3" name="user" sig="user: string" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L34" sourceLabel="types.ts:34" />
