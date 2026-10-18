---
title: Connection
kind: interface
longname: module:transport.Connection
---

# Connection

<Signature
  code="interface Connection {
	kind: 'ssh' | 'local' | 'network' | 'http';
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	exec(command: string, options?: ExecOptions): Promise<ExecResult>;
	facts(): Promise<ConnectionFacts>;
	health(): Promise<HealthStatus>;
}"
/>

<SourceLink href="/source/src/transport/connection-ts/#L294" label="connection.ts:294" />

#### Implemented By

- [`HttpApiConnection`](/module/transport/httpapiconnection)
- [`LocalConnection`](/module/transport/localconnection)
- [`NetworkSshConnection`](/module/transport/networksshconnection)
- [`SshConnection`](/module/transport/sshconnection)

---

## Properties

<MemberHeading id="kind" depth="3" name="kind" sig="kind: 'ssh' | 'local' | 'network' | 'http'" />

<MemberMeta badges="readonly" sourceHref="/source/src/transport/connection-ts/#L295" sourceLabel="connection.ts:295" />

## Methods

<MemberHeading id="connect" depth="3" name="connect" sig="connect(): Promise<void>" />

<MemberMeta badges="async" sourceHref="/source/src/transport/connection-ts/#L297" sourceLabel="connection.ts:297" />

Establish the underlying transport (idempotent once connected).

**Returns**

- `Promise<void>`

<MemberHeading id="disconnect" depth="3" name="disconnect" sig="disconnect(): Promise<void>" />

<MemberMeta badges="async" sourceHref="/source/src/transport/connection-ts/#L303" sourceLabel="connection.ts:303" />

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

<MemberMeta badges="async" sourceHref="/source/src/transport/connection-ts/#L299" sourceLabel="connection.ts:299" />

Run a command, returning captured stdout/stderr/exit code.

**Parameters**

- `command` (string)
- `options` ([ExecOptions](/module/transport/execoptions), optional)

**Returns**

- `Promise<`[`ExecResult`](/module/transport/execresult)`>`

<MemberHeading id="facts" depth="3" name="facts" sig="facts(): Promise<ConnectionFacts>" />

<MemberMeta badges="async" sourceHref="/source/src/transport/connection-ts/#L301" sourceLabel="connection.ts:301" />

Best-effort targeted fact gathering for the target.

**Returns**

- `Promise<`[`ConnectionFacts`](/module/transport/connectionfacts)`>`

<MemberHeading id="health" depth="3" name="health" sig="health(): Promise<HealthStatus>" />

<MemberMeta badges="async" sourceHref="/source/src/transport/connection-ts/#L305" sourceLabel="connection.ts:305" />

Liveness probe (trivial command + latency).

**Returns**

- `Promise<`[`HealthStatus`](/module/transport/healthstatus)`>`
