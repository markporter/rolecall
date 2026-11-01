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
	protocol?: 'http' | 'https';
	request: HttpApiRequest;
	retry?: Partial<RetryConfig>;
	timeoutMs?: number;
	user: string;
}"
/>

<SourceLink href="/source/src/transport/connection-ts/#L153" label="connection.ts:153" />

#### Hierarchy

- [`BaseConnectionOptions`](/module/transport/baseconnectionoptions)
- `HttpApiConnectionOptions`

---

## Properties

<MemberHeading id="auth" depth="3" name="auth" sig="auth: HttpAuth" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L159" sourceLabel="connection.ts:159" />

<MemberHeading id="basepath" depth="3" name="basePath" sig="basePath: string" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L158" sourceLabel="connection.ts:158" />

Path prefix prepended to request.path (e.g. "/api/v1").

<MemberHeading id="concurrency" depth="3" name="concurrency" sig="concurrency: number" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L89" sourceLabel="connection.ts:89" />

_Inherited from&#x20;_[`concurrency`](/module/transport/baseconnectionoptions#concurrency)

Max concurrent in-flight exec calls (p-limit).

<MemberHeading id="credentials" depth="3" name="credentials" sig="credentials: Credentials" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L83" sourceLabel="connection.ts:83" />

_Inherited from&#x20;_[`credentials`](/module/transport/baseconnectionoptions#credentials)

<MemberHeading id="grpc" depth="3" name="grpc" sig="grpc: HttpGrpcCapability" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L168" sourceLabel="connection.ts:168" />

Deferred gRPC capability — setting this throws at connect().

<MemberHeading id="healthpath" depth="3" name="healthPath" sig="healthPath: string" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L165" sourceLabel="connection.ts:165" />

Path used by health(); defaults to request.path.

<MemberHeading id="host" depth="3" name="host" sig="host: string" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L80" sourceLabel="connection.ts:80" />

_Inherited from&#x20;_[`host`](/module/transport/baseconnectionoptions#host)

<MemberHeading id="kind" depth="3" name="kind" sig="kind: 'http'" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L154" sourceLabel="connection.ts:154" />

<MemberHeading id="poolsize" depth="3" name="poolSize" sig="poolSize: number" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L163" sourceLabel="connection.ts:163" />

undici Pool max sockets; bounds concurrent in-flight requests.

<MemberHeading id="port" depth="3" name="port" sig="port: number" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L81" sourceLabel="connection.ts:81" />

_Inherited from&#x20;_[`port`](/module/transport/baseconnectionoptions#port)

<MemberHeading id="protocol" depth="3" name="protocol" sig="protocol: 'http' | 'https'" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L156" sourceLabel="connection.ts:156" />

URL scheme (default http).

<MemberHeading id="request" depth="3" name="request" sig="request: HttpApiRequest" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L161" sourceLabel="connection.ts:161" />

The configured request issued by exec().

<MemberHeading id="retry" depth="3" name="retry" sig="retry: Partial<RetryConfig>" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L87" sourceLabel="connection.ts:87" />

_Inherited from&#x20;_[`retry`](/module/transport/baseconnectionoptions#retry)

Partial retry overrides merged onto DEFAULT_RETRY_CONFIG.

<MemberHeading id="timeoutms" depth="3" name="timeoutMs" sig="timeoutMs: number" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L85" sourceLabel="connection.ts:85" />

_Inherited from&#x20;_[`timeoutMs`](/module/transport/baseconnectionoptions#timeoutms)

Default exec timeout in ms.

<MemberHeading id="user" depth="3" name="user" sig="user: string" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L82" sourceLabel="connection.ts:82" />

_Inherited from&#x20;_[`user`](/module/transport/baseconnectionoptions#user)
