---
title: NetworkConnectionOptions
kind: interface
longname: module:transport.NetworkConnectionOptions
---

# NetworkConnectionOptions

<Signature
  code="interface NetworkConnectionOptions extends module:transport.BaseConnectionOptions {
	concurrency?: number;
	credentials?: Credentials;
	driver?: VendorDriver;
	host: string;
	kind: 'network';
	knownHostsPath?: string;
	port?: number;
	retry?: Partial<RetryConfig>;
	strictHostKeyChecking?: boolean;
	timeoutMs?: number;
	user: string;
}"
/>

<SourceLink href="/source/src/transport/connection-ts/#L117" label="connection.ts:117" />

#### Hierarchy

- [`BaseConnectionOptions`](/module/transport/baseconnectionoptions)
- `NetworkConnectionOptions`

---

## Properties

<MemberHeading id="concurrency" depth="3" name="concurrency" sig="concurrency: number" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L83" sourceLabel="connection.ts:83" />

_Inherited from&#x20;_[`concurrency`](/module/transport/baseconnectionoptions#concurrency)

Max concurrent in-flight exec calls (p-limit).

<MemberHeading id="credentials" depth="3" name="credentials" sig="credentials: Credentials" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L77" sourceLabel="connection.ts:77" />

_Inherited from&#x20;_[`credentials`](/module/transport/baseconnectionoptions#credentials)

<MemberHeading id="driver" depth="3" name="driver" sig="driver: VendorDriver" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L120" sourceLabel="connection.ts:120" />

Vendor CLI driver; defaults to IOS_DRIVER when omitted.

<MemberHeading id="host" depth="3" name="host" sig="host: string" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L74" sourceLabel="connection.ts:74" />

_Inherited from&#x20;_[`host`](/module/transport/baseconnectionoptions#host)

<MemberHeading id="kind" depth="3" name="kind" sig="kind: 'network'" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L118" sourceLabel="connection.ts:118" />

<MemberHeading id="knownhostspath" depth="3" name="knownHostsPath" sig="knownHostsPath: string" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L122" sourceLabel="connection.ts:122" />

Path to a known_hosts file; defaults to \~/.ssh/known_hosts.

<MemberHeading id="port" depth="3" name="port" sig="port: number" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L75" sourceLabel="connection.ts:75" />

_Inherited from&#x20;_[`port`](/module/transport/baseconnectionoptions#port)

<MemberHeading id="retry" depth="3" name="retry" sig="retry: Partial<RetryConfig>" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L81" sourceLabel="connection.ts:81" />

_Inherited from&#x20;_[`retry`](/module/transport/baseconnectionoptions#retry)

Partial retry overrides merged onto DEFAULT_RETRY_CONFIG.

<MemberHeading id="stricthostkeychecking" depth="3" name="strictHostKeyChecking" sig="strictHostKeyChecking: boolean" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L124" sourceLabel="connection.ts:124" />

When false, any host key is accepted (insecure; tests/trust-on-first-use).

<MemberHeading id="timeoutms" depth="3" name="timeoutMs" sig="timeoutMs: number" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L79" sourceLabel="connection.ts:79" />

_Inherited from&#x20;_[`timeoutMs`](/module/transport/baseconnectionoptions#timeoutms)

Default exec timeout in ms.

<MemberHeading id="user" depth="3" name="user" sig="user: string" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L76" sourceLabel="connection.ts:76" />

_Inherited from&#x20;_[`user`](/module/transport/baseconnectionoptions#user)
