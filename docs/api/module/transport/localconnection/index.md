---
title: LocalConnection
kind: class
longname: module:transport.LocalConnection
---

# LocalConnection

<SourceLink href="/source/src/transport/local-ts/#L41" label="local.ts:41" />

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

<MemberMeta badges="readonly" sourceHref="/source/src/transport/local-ts/#L42" sourceLabel="local.ts:42" />

_Implementation of&#x20;_[`kind`](/module/transport/connection#kind)

<MemberHeading id="options" depth="3" name="options" sig="options: LocalConnectionOptions" />

<MemberMeta badges="readonly" sourceHref="/source/src/transport/local-ts/#L43" sourceLabel="local.ts:43" />

## Methods

<MemberHeading id="connect" depth="3" name="connect" sig="connect(): Promise<void>" />

<MemberMeta badges="async" sourceHref="/source/src/transport/local-ts/#L95" sourceLabel="local.ts:95" />

_Implementation of&#x20;_[`connect`](/module/transport/connection#connect)

Establish the underlying transport (idempotent once connected).

**Returns**

- `Promise<void>`

<MemberHeading id="disconnect" depth="3" name="disconnect" sig="disconnect(): Promise<void>" />

<MemberMeta badges="async" sourceHref="/source/src/transport/local-ts/#L268" sourceLabel="local.ts:268" />

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

<MemberMeta badges="async" sourceHref="/source/src/transport/local-ts/#L242" sourceLabel="local.ts:242" />

_Implementation of&#x20;_[`exec`](/module/transport/connection#exec)

Run a command, returning captured stdout/stderr/exit code.

**Parameters**

- `command` (string)
- `options` ([ExecOptions](/module/transport/execoptions), optional)

**Returns**

- `Promise<`[`ExecResult`](/module/transport/execresult)`>`

<MemberHeading id="facts" depth="3" name="facts" sig="facts(): Promise<ConnectionFacts>" />

<MemberMeta badges="async" sourceHref="/source/src/transport/local-ts/#L246" sourceLabel="local.ts:246" />

_Implementation of&#x20;_[`facts`](/module/transport/connection#facts)

Best-effort targeted fact gathering for the target.

**Returns**

- `Promise<`[`ConnectionFacts`](/module/transport/connectionfacts)`>`

<MemberHeading id="health" depth="3" name="health" sig="health(): Promise<HealthStatus>" />

<MemberMeta badges="async" sourceHref="/source/src/transport/local-ts/#L256" sourceLabel="local.ts:256" />

_Implementation of&#x20;_[`health`](/module/transport/connection#health)

Liveness probe (trivial command + latency).

**Returns**

- `Promise<`[`HealthStatus`](/module/transport/healthstatus)`>`
