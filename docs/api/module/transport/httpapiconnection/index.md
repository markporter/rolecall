---
title: HttpApiConnection
kind: class
longname: module:transport.HttpApiConnection
---

# HttpApiConnection

<SourceLink href="/source/src/transport/http-ts/#L36" label="http.ts:36" />

---

## Constructors

<MemberHeading
  id="constructor"
  depth="3"
  name="constructor"
  sig="new HttpApiConnection(
	options: HttpApiConnectionOptions,
): HttpApiConnection"
/>

**Parameters**

- `options` ([HttpApiConnectionOptions](/module/transport/httpapiconnectionoptions))

**Returns**

`HttpApiConnection`

#### Implements

- [`Connection`](/module/transport/connection)

---

## Properties

<MemberHeading id="kind" depth="3" name="kind" sig="kind: 'http'" />

<MemberMeta badges="readonly" sourceHref="/source/src/transport/http-ts/#L37" sourceLabel="http.ts:37" />

_Implementation of&#x20;_[`kind`](/module/transport/connection#kind)

<MemberHeading id="options" depth="3" name="options" sig="options: HttpApiConnectionOptions" />

<MemberMeta badges="readonly" sourceHref="/source/src/transport/http-ts/#L38" sourceLabel="http.ts:38" />

## Methods

<MemberHeading id="connect" depth="3" name="connect" sig="connect(): Promise<void>" />

<MemberMeta badges="async" sourceHref="/source/src/transport/http-ts/#L57" sourceLabel="http.ts:57" />

_Implementation of&#x20;_[`connect`](/module/transport/connection#connect)

Establish the underlying transport (idempotent once connected).

**Returns**

- `Promise<void>`

<MemberHeading id="disconnect" depth="3" name="disconnect" sig="disconnect(): Promise<void>" />

<MemberMeta badges="async" sourceHref="/source/src/transport/http-ts/#L167" sourceLabel="http.ts:167" />

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

<MemberMeta badges="async" sourceHref="/source/src/transport/http-ts/#L105" sourceLabel="http.ts:105" />

_Implementation of&#x20;_[`exec`](/module/transport/connection#exec)

Run a command, returning captured stdout/stderr/exit code.

**Parameters**

- `command` (string)
- `options` ([ExecOptions](/module/transport/execoptions), optional)

**Returns**

- `Promise<`[`ExecResult`](/module/transport/execresult)`>`

<MemberHeading id="facts" depth="3" name="facts" sig="facts(): Promise<ConnectionFacts>" />

<MemberMeta badges="async" sourceHref="/source/src/transport/http-ts/#L132" sourceLabel="http.ts:132" />

_Implementation of&#x20;_[`facts`](/module/transport/connection#facts)

Best-effort targeted fact gathering for the target.

**Returns**

- `Promise<`[`ConnectionFacts`](/module/transport/connectionfacts)`>`

<MemberHeading id="health" depth="3" name="health" sig="health(): Promise<HealthStatus>" />

<MemberMeta badges="async" sourceHref="/source/src/transport/http-ts/#L138" sourceLabel="http.ts:138" />

_Implementation of&#x20;_[`health`](/module/transport/connection#health)

Liveness probe (trivial command + latency).

**Returns**

- `Promise<`[`HealthStatus`](/module/transport/healthstatus)`>`
