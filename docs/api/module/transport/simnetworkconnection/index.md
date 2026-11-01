---
title: SimNetworkConnection
kind: class
longname: module:transport.SimNetworkConnection
---

# SimNetworkConnection

<SourceLink href="/source/src/transport/sim-network-ts/#L26" label="sim-network.ts:26" />

---

## Constructors

<MemberHeading
  id="constructor"
  depth="3"
  name="constructor"
  sig="new SimNetworkConnection(
	options: SimNetworkConnectionOptions,
): SimNetworkConnection"
/>

**Parameters**

- `options` ([SimNetworkConnectionOptions](/module/transport/simnetworkconnectionoptions))

**Returns**

`SimNetworkConnection`

#### Implements

- [`Connection`](/module/transport/connection)

---

## Properties

<MemberHeading id="kind" depth="3" name="kind" sig="kind: 'network'" />

<MemberMeta badges="readonly" sourceHref="/source/src/transport/sim-network-ts/#L27" sourceLabel="sim-network.ts:27" />

_Implementation of&#x20;_[`kind`](/module/transport/connection#kind)

## Methods

<MemberHeading id="connect" depth="3" name="connect" sig="connect(): Promise<void>" />

<MemberMeta badges="async" sourceHref="/source/src/transport/sim-network-ts/#L41" sourceLabel="sim-network.ts:41" />

_Implementation of&#x20;_[`connect`](/module/transport/connection#connect)

Establish the underlying transport (idempotent once connected).

**Returns**

- `Promise<void>`

<MemberHeading id="disconnect" depth="3" name="disconnect" sig="disconnect(): Promise<void>" />

<MemberMeta badges="async" sourceHref="/source/src/transport/sim-network-ts/#L92" sourceLabel="sim-network.ts:92" />

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
	_options?: ExecOptions,
): Promise<ExecResult>"
/>

<MemberMeta badges="async" sourceHref="/source/src/transport/sim-network-ts/#L50" sourceLabel="sim-network.ts:50" />

_Implementation of&#x20;_[`exec`](/module/transport/connection#exec)

Run a command, returning captured stdout/stderr/exit code.

**Parameters**

- `command` (string)
- `_options` ([ExecOptions](/module/transport/execoptions), optional)

**Returns**

- `Promise<`[`ExecResult`](/module/transport/execresult)`>`

<MemberHeading id="facts" depth="3" name="facts" sig="facts(): Promise<ConnectionFacts>" />

<MemberMeta badges="async" sourceHref="/source/src/transport/sim-network-ts/#L71" sourceLabel="sim-network.ts:71" />

_Implementation of&#x20;_[`facts`](/module/transport/connection#facts)

Best-effort targeted fact gathering for the target.

**Returns**

- `Promise<`[`ConnectionFacts`](/module/transport/connectionfacts)`>`

<MemberHeading id="health" depth="3" name="health" sig="health(): Promise<HealthStatus>" />

<MemberMeta badges="async" sourceHref="/source/src/transport/sim-network-ts/#L75" sourceLabel="sim-network.ts:75" />

_Implementation of&#x20;_[`health`](/module/transport/connection#health)

Liveness probe (trivial command + latency).

**Returns**

- `Promise<`[`HealthStatus`](/module/transport/healthstatus)`>`
