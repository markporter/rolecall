---
title: SshConnection
kind: class
longname: module:transport.SshConnection
---

# SshConnection

<SourceLink href="/source/src/transport/ssh-ts/#L108" label="ssh.ts:108" />

---

## Constructors

<MemberHeading id="constructor" depth="3" name="constructor" sig="new SshConnection(options: SshConnectionOptions): SshConnection" />

**Parameters**

- `options` ([SshConnectionOptions](/module/transport/sshconnectionoptions))

**Returns**

`SshConnection`

#### Implements

- [`Connection`](/module/transport/connection)

---

## Properties

<MemberHeading id="kind" depth="3" name="kind" sig="kind: 'ssh'" />

<MemberMeta badges="readonly" sourceHref="/source/src/transport/ssh-ts/#L109" sourceLabel="ssh.ts:109" />

_Implementation of&#x20;_[`kind`](/module/transport/connection#kind)

<MemberHeading id="options" depth="3" name="options" sig="options: SshConnectionOptions" />

<MemberMeta badges="readonly" sourceHref="/source/src/transport/ssh-ts/#L110" sourceLabel="ssh.ts:110" />

## Methods

<MemberHeading id="connect" depth="3" name="connect" sig="connect(): Promise<void>" />

<MemberMeta badges="async" sourceHref="/source/src/transport/ssh-ts/#L125" sourceLabel="ssh.ts:125" />

_Implementation of&#x20;_[`connect`](/module/transport/connection#connect)

Establish the underlying transport (idempotent once connected).

**Returns**

- `Promise<void>`

<MemberHeading id="disconnect" depth="3" name="disconnect" sig="disconnect(): Promise<void>" />

<MemberMeta badges="async" sourceHref="/source/src/transport/ssh-ts/#L237" sourceLabel="ssh.ts:237" />

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

<MemberMeta badges="async" sourceHref="/source/src/transport/ssh-ts/#L207" sourceLabel="ssh.ts:207" />

_Implementation of&#x20;_[`exec`](/module/transport/connection#exec)

Run a command, returning captured stdout/stderr/exit code.

**Parameters**

- `command` (string)
- `options` ([ExecOptions](/module/transport/execoptions), optional)

**Returns**

- `Promise<`[`ExecResult`](/module/transport/execresult)`>`

<MemberHeading id="facts" depth="3" name="facts" sig="facts(): Promise<ConnectionFacts>" />

<MemberMeta badges="async" sourceHref="/source/src/transport/ssh-ts/#L211" sourceLabel="ssh.ts:211" />

_Implementation of&#x20;_[`facts`](/module/transport/connection#facts)

Best-effort targeted fact gathering for the target.

**Returns**

- `Promise<`[`ConnectionFacts`](/module/transport/connectionfacts)`>`

<MemberHeading id="health" depth="3" name="health" sig="health(): Promise<HealthStatus>" />

<MemberMeta badges="async" sourceHref="/source/src/transport/ssh-ts/#L225" sourceLabel="ssh.ts:225" />

_Implementation of&#x20;_[`health`](/module/transport/connection#health)

Liveness probe (trivial command + latency).

**Returns**

- `Promise<`[`HealthStatus`](/module/transport/healthstatus)`>`
