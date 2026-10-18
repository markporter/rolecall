---
title: BaseConnectionOptions
kind: interface
longname: module:transport.BaseConnectionOptions
---

# BaseConnectionOptions

<Signature
  code="interface BaseConnectionOptions {
	concurrency?: number;
	credentials?: Credentials;
	host: string;
	port?: number;
	retry?: Partial<RetryConfig>;
	timeoutMs?: number;
	user: string;
}"
/>

<SourceLink href="/source/src/transport/connection-ts/#L73" label="connection.ts:73" />

---

## Properties

<MemberHeading id="concurrency" depth="3" name="concurrency" sig="concurrency: number" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L83" sourceLabel="connection.ts:83" />

Max concurrent in-flight exec calls (p-limit).

<MemberHeading id="credentials" depth="3" name="credentials" sig="credentials: Credentials" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L77" sourceLabel="connection.ts:77" />

<MemberHeading id="host" depth="3" name="host" sig="host: string" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L74" sourceLabel="connection.ts:74" />

<MemberHeading id="port" depth="3" name="port" sig="port: number" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L75" sourceLabel="connection.ts:75" />

<MemberHeading id="retry" depth="3" name="retry" sig="retry: Partial<RetryConfig>" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L81" sourceLabel="connection.ts:81" />

Partial retry overrides merged onto DEFAULT_RETRY_CONFIG.

<MemberHeading id="timeoutms" depth="3" name="timeoutMs" sig="timeoutMs: number" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L79" sourceLabel="connection.ts:79" />

Default exec timeout in ms.

<MemberHeading id="user" depth="3" name="user" sig="user: string" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L76" sourceLabel="connection.ts:76" />
