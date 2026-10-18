---
title: HttpApiConnectionOptions
kind: interface
longname: module:transport.HttpApiConnectionOptions
---

# HttpApiConnectionOptions

<Signature
  code="interface HttpApiConnectionOptions extends module:transport.BaseConnectionOptions {
	auth?: HttpAuth;
	basePath?: string;
	concurrency?: number;
	credentials?: Credentials;
	grpc?: HttpGrpcCapability;
	healthPath?: string;
	host: string;
	kind: 'http';
	poolSize?: number;
	port?: number;
	request: HttpApiRequest;
	retry?: Partial<RetryConfig>;
	timeoutMs?: number;
	user: string;
}"
/>

<SourceLink href="/source/src/transport/connection-ts/#L145" label="connection.ts:145" />

#### Hierarchy

- [`BaseConnectionOptions`](/module/transport/baseconnectionoptions)
- `HttpApiConnectionOptions`

---

## Properties

<MemberHeading id="auth" depth="3" name="auth" sig="auth: HttpAuth" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L149" sourceLabel="connection.ts:149" />

<MemberHeading id="basepath" depth="3" name="basePath" sig="basePath: string" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L148" sourceLabel="connection.ts:148" />

Path prefix prepended to request.path (e.g. "/api/v1").

<MemberHeading id="concurrency" depth="3" name="concurrency" sig="concurrency: number" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L83" sourceLabel="connection.ts:83" />

_Inherited from&#x20;_[`concurrency`](/module/transport/baseconnectionoptions#concurrency)

Max concurrent in-flight exec calls (p-limit).

<MemberHeading id="credentials" depth="3" name="credentials" sig="credentials: Credentials" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L77" sourceLabel="connection.ts:77" />

_Inherited from&#x20;_[`credentials`](/module/transport/baseconnectionoptions#credentials)

<MemberHeading id="grpc" depth="3" name="grpc" sig="grpc: HttpGrpcCapability" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L158" sourceLabel="connection.ts:158" />

Deferred gRPC capability — setting this throws at connect().

<MemberHeading id="healthpath" depth="3" name="healthPath" sig="healthPath: string" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L155" sourceLabel="connection.ts:155" />

Path used by health(); defaults to request.path.

<MemberHeading id="host" depth="3" name="host" sig="host: string" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L74" sourceLabel="connection.ts:74" />

_Inherited from&#x20;_[`host`](/module/transport/baseconnectionoptions#host)

<MemberHeading id="kind" depth="3" name="kind" sig="kind: 'http'" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L146" sourceLabel="connection.ts:146" />

<MemberHeading id="poolsize" depth="3" name="poolSize" sig="poolSize: number" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L153" sourceLabel="connection.ts:153" />

undici Pool max sockets; bounds concurrent in-flight requests.

<MemberHeading id="port" depth="3" name="port" sig="port: number" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L75" sourceLabel="connection.ts:75" />

_Inherited from&#x20;_[`port`](/module/transport/baseconnectionoptions#port)

<MemberHeading id="request" depth="3" name="request" sig="request: HttpApiRequest" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L151" sourceLabel="connection.ts:151" />

The configured request issued by exec().

<MemberHeading id="retry" depth="3" name="retry" sig="retry: Partial<RetryConfig>" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L81" sourceLabel="connection.ts:81" />

_Inherited from&#x20;_[`retry`](/module/transport/baseconnectionoptions#retry)

Partial retry overrides merged onto DEFAULT_RETRY_CONFIG.

<MemberHeading id="timeoutms" depth="3" name="timeoutMs" sig="timeoutMs: number" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L79" sourceLabel="connection.ts:79" />

_Inherited from&#x20;_[`timeoutMs`](/module/transport/baseconnectionoptions#timeoutms)

Default exec timeout in ms.

<MemberHeading id="user" depth="3" name="user" sig="user: string" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L76" sourceLabel="connection.ts:76" />

_Inherited from&#x20;_[`user`](/module/transport/baseconnectionoptions#user)
