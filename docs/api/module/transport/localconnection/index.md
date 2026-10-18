---
title: LocalConnection
kind: class
longname: module:transport.LocalConnection
---

# LocalConnection

<SourceLink href="/source/src/transport/local-ts/#L26" label="local.ts:26" />

---

## Constructors

<MemberHeading
  id="constructor"
  depth="3"
  name="constructor"
  sig="new LocalConnection(
	options: LocalConnectionOptions,
): LocalConnection"
/>

**Parameters**

- `options` ([LocalConnectionOptions](/module/transport/localconnectionoptions))

**Returns**

`LocalConnection`

#### Implements

- [`Connection`](/module/transport/connection)

---

## Properties

<MemberHeading id="kind" depth="3" name="kind" sig="kind: 'local'" />

<MemberMeta badges="readonly" sourceHref="/source/src/transport/local-ts/#L27" sourceLabel="local.ts:27" />

_Implementation of&#x20;_[`kind`](/module/transport/connection#kind)

<MemberHeading id="options" depth="3" name="options" sig="options: LocalConnectionOptions" />

<MemberMeta badges="readonly" sourceHref="/source/src/transport/local-ts/#L28" sourceLabel="local.ts:28" />

## Methods

<MemberHeading id="connect" depth="3" name="connect" sig="connect(): Promise<void>" />

<MemberMeta badges="async" sourceHref="/source/src/transport/local-ts/#L49" sourceLabel="local.ts:49" />

_Implementation of&#x20;_[`connect`](/module/transport/connection#connect)

Establish the underlying transport (idempotent once connected).

**Returns**

- `Promise<void>`

<MemberHeading id="disconnect" depth="3" name="disconnect" sig="disconnect(): Promise<void>" />

<MemberMeta badges="async" sourceHref="/source/src/transport/local-ts/#L98" sourceLabel="local.ts:98" />

_Implementation of&#x20;_[`disconnect`](/module/transport/connection#disconnect)

Tear down the underlying transport.

**Returns**

- `Promise<void>`

<MemberHeading
  id="exec"
  depth="3"
  name="exec"
  sig="exec(
	command: string,
	options?: ExecOptions,
): Promise<ExecResult>"
/>

<MemberMeta badges="async" sourceHref="/source/src/transport/local-ts/#L72" sourceLabel="local.ts:72" />

_Implementation of&#x20;_[`exec`](/module/transport/connection#exec)

Run a command, returning captured stdout/stderr/exit code.

**Parameters**

- `command` (string)
- `options` ([ExecOptions](/module/transport/execoptions), optional)

**Returns**

- `Promise<`[`ExecResult`](/module/transport/execresult)`>`

<MemberHeading id="facts" depth="3" name="facts" sig="facts(): Promise<ConnectionFacts>" />

<MemberMeta badges="async" sourceHref="/source/src/transport/local-ts/#L76" sourceLabel="local.ts:76" />

_Implementation of&#x20;_[`facts`](/module/transport/connection#facts)

Best-effort targeted fact gathering for the target.

**Returns**

- `Promise<`[`ConnectionFacts`](/module/transport/connectionfacts)`>`

<MemberHeading id="health" depth="3" name="health" sig="health(): Promise<HealthStatus>" />

<MemberMeta badges="async" sourceHref="/source/src/transport/local-ts/#L86" sourceLabel="local.ts:86" />

_Implementation of&#x20;_[`health`](/module/transport/connection#health)

Liveness probe (trivial command + latency).

**Returns**

- `Promise<`[`HealthStatus`](/module/transport/healthstatus)`>`
