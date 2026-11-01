---
title: LocalConnectionOptions
kind: interface
longname: module:transport.LocalConnectionOptions
---

# LocalConnectionOptions

<Signature
  code="interface LocalConnectionOptions extends module:transport.BaseConnectionOptions {
	concurrency?: number;
	credentials?: Credentials;
	host: string;
	isolation?: IsolationOptions;
	kind: 'local';
	port?: number;
	retry?: Partial<RetryConfig>;
	shell?: string;
	timeoutMs?: number;
	user: string;
}"
/>

<SourceLink href="/source/src/transport/connection-ts/#L100" label="connection.ts:100" />

#### Hierarchy

- [`BaseConnectionOptions`](/module/transport/baseconnectionoptions)
- `LocalConnectionOptions`

---

## Properties

<MemberHeading id="concurrency" depth="3" name="concurrency" sig="concurrency: number" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L89" sourceLabel="connection.ts:89" />

_Inherited from&#x20;_[`concurrency`](/module/transport/baseconnectionoptions#concurrency)

Max concurrent in-flight exec calls (p-limit).

<MemberHeading id="credentials" depth="3" name="credentials" sig="credentials: Credentials" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L83" sourceLabel="connection.ts:83" />

_Inherited from&#x20;_[`credentials`](/module/transport/baseconnectionoptions#credentials)

<MemberHeading id="host" depth="3" name="host" sig="host: string" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L80" sourceLabel="connection.ts:80" />

_Inherited from&#x20;_[`host`](/module/transport/baseconnectionoptions#host)

<MemberHeading id="isolation" depth="3" name="isolation" sig="isolation: IsolationOptions" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L105" sourceLabel="connection.ts:105" />

Optional ADR 0025 sandbox. Omit for direct, unsandboxed library execution.

<MemberHeading id="kind" depth="3" name="kind" sig="kind: 'local'" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L101" sourceLabel="connection.ts:101" />

<MemberHeading id="port" depth="3" name="port" sig="port: number" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L81" sourceLabel="connection.ts:81" />

_Inherited from&#x20;_[`port`](/module/transport/baseconnectionoptions#port)

<MemberHeading id="retry" depth="3" name="retry" sig="retry: Partial<RetryConfig>" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L87" sourceLabel="connection.ts:87" />

_Inherited from&#x20;_[`retry`](/module/transport/baseconnectionoptions#retry)

Partial retry overrides merged onto DEFAULT_RETRY_CONFIG.

<MemberHeading id="shell" depth="3" name="shell" sig="shell: string" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L103" sourceLabel="connection.ts:103" />

Shell used to evaluate commands; defaults to /bin/sh.

<MemberHeading id="timeoutms" depth="3" name="timeoutMs" sig="timeoutMs: number" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L85" sourceLabel="connection.ts:85" />

_Inherited from&#x20;_[`timeoutMs`](/module/transport/baseconnectionoptions#timeoutms)

Default exec timeout in ms.

<MemberHeading id="user" depth="3" name="user" sig="user: string" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L82" sourceLabel="connection.ts:82" />

_Inherited from&#x20;_[`user`](/module/transport/baseconnectionoptions#user)
