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

<SourceLink href="/source/src/transport/connection-ts/#L79" label="connection.ts:79" />

---

## Properties

<MemberHeading id="concurrency" depth="3" name="concurrency" sig="concurrency: number" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L89" sourceLabel="connection.ts:89" />

Max concurrent in-flight exec calls (p-limit).

<MemberHeading id="credentials" depth="3" name="credentials" sig="credentials: Credentials" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L83" sourceLabel="connection.ts:83" />

<MemberHeading id="host" depth="3" name="host" sig="host: string" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L80" sourceLabel="connection.ts:80" />

<MemberHeading id="port" depth="3" name="port" sig="port: number" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L81" sourceLabel="connection.ts:81" />

<MemberHeading id="retry" depth="3" name="retry" sig="retry: Partial<RetryConfig>" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L87" sourceLabel="connection.ts:87" />

Partial retry overrides merged onto DEFAULT_RETRY_CONFIG.

<MemberHeading id="timeoutms" depth="3" name="timeoutMs" sig="timeoutMs: number" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L85" sourceLabel="connection.ts:85" />

Default exec timeout in ms.

<MemberHeading id="user" depth="3" name="user" sig="user: string" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L82" sourceLabel="connection.ts:82" />
