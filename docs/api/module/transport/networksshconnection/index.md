---
title: NetworkSshConnection
kind: class
longname: module:transport.NetworkSshConnection
---

# NetworkSshConnection

<SourceLink href="/source/src/transport/network-ts/#L62" label="network.ts:62" />

---

## Constructors

<MemberHeading
  id="constructor"
  depth="3"
  name="constructor"
  sig="new NetworkSshConnection(
	options: NetworkConnectionOptions,
): NetworkSshConnection"
/>

**Parameters**

- `options` ([NetworkConnectionOptions](/module/transport/networkconnectionoptions))

**Returns**

`NetworkSshConnection`

#### Implements

- [`Connection`](/module/transport/connection)

---

## Properties

<MemberHeading id="driver" depth="3" name="driver" sig="driver: VendorDriver" />

<MemberMeta badges="readonly" sourceHref="/source/src/transport/network-ts/#L65" sourceLabel="network.ts:65" />

<MemberHeading id="kind" depth="3" name="kind" sig="kind: 'network'" />

<MemberMeta badges="readonly" sourceHref="/source/src/transport/network-ts/#L63" sourceLabel="network.ts:63" />

_Implementation of&#x20;_[`kind`](/module/transport/connection#kind)

<MemberHeading id="options" depth="3" name="options" sig="options: NetworkConnectionOptions" />

<MemberMeta badges="readonly" sourceHref="/source/src/transport/network-ts/#L64" sourceLabel="network.ts:64" />

## Methods

<MemberHeading
  id="apply"
  depth="3"
  name="apply"
  sig="apply(
	candidate: string,
	opts: ApplyOptions,
): Promise<ApplyResult>"
/>

<MemberMeta badges="async" sourceHref="/source/src/transport/network-ts/#L130" sourceLabel="network.ts:130" />

Reconcile the device to `candidate`:

1. fetch running config, 2. normalize + diff, 3. if unchanged → no-op (idempotent), 4. else apply delta (merge) or whole config (replace) inside config mode, 5. commit atomically (optionally with revert timer).

**Parameters**

- `candidate` (string)
- `opts` ([ApplyOptions](/module/transport/applyoptions), default: "{}")

**Returns**

- `Promise<`[`ApplyResult`](/module/transport/applyresult)`>`

<MemberHeading id="connect" depth="3" name="connect" sig="connect(): Promise<void>" />

<MemberMeta badges="async" sourceHref="/source/src/transport/network-ts/#L85" sourceLabel="network.ts:85" />

_Implementation of&#x20;_[`connect`](/module/transport/connection#connect)

Establish the underlying transport (idempotent once connected).

**Returns**

- `Promise<void>`

<MemberHeading id="diff" depth="3" name="diff" sig="diff(candidate: string): Promise<ConfigDiff>" />

<MemberMeta badges="async" sourceHref="/source/src/transport/network-ts/#L119" sourceLabel="network.ts:119" />

Compute the candidate-vs-running diff without applying anything.

**Parameters**

- `candidate` (string)

**Returns**

- `Promise<`[`ConfigDiff`](/module/transport/configdiff)`>`

<MemberHeading id="disconnect" depth="3" name="disconnect" sig="disconnect(): Promise<void>" />

<MemberMeta badges="async" sourceHref="/source/src/transport/network-ts/#L89" sourceLabel="network.ts:89" />

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

<MemberMeta badges="async" sourceHref="/source/src/transport/network-ts/#L93" sourceLabel="network.ts:93" />

_Implementation of&#x20;_[`exec`](/module/transport/connection#exec)

Run a command, returning captured stdout/stderr/exit code.

**Parameters**

- `command` (string)
- `options` ([ExecOptions](/module/transport/execoptions), optional)

**Returns**

- `Promise<`[`ExecResult`](/module/transport/execresult)`>`

<MemberHeading id="facts" depth="3" name="facts" sig="facts(): Promise<ConnectionFacts>" />

<MemberMeta badges="async" sourceHref="/source/src/transport/network-ts/#L99" sourceLabel="network.ts:99" />

_Implementation of&#x20;_[`facts`](/module/transport/connection#facts)

Best-effort targeted fact gathering for the target.

**Returns**

- `Promise<`[`ConnectionFacts`](/module/transport/connectionfacts)`>`

<MemberHeading id="health" depth="3" name="health" sig="health(): Promise<HealthStatus>" />

<MemberMeta badges="async" sourceHref="/source/src/transport/network-ts/#L108" sourceLabel="network.ts:108" />

_Implementation of&#x20;_[`health`](/module/transport/connection#health)

Liveness probe (trivial command + latency).

**Returns**

- `Promise<`[`HealthStatus`](/module/transport/healthstatus)`>`
