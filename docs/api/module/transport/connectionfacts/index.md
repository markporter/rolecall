---
title: ConnectionFacts
kind: interface
longname: module:transport.ConnectionFacts
---

# ConnectionFacts

<Signature
  code="interface ConnectionFacts {
	host: string;
	os?: string;
	shell?: string;
	transport: 'ssh' | 'local' | 'network' | 'http';
	user: string;
}"
/>

<SourceLink href="/source/src/transport/connection-ts/#L24" label="connection.ts:24" />

---

## Properties

<MemberHeading id="host" depth="3" name="host" sig="host: string" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L25" sourceLabel="connection.ts:25" />

<MemberHeading id="os" depth="3" name="os" sig="os: string" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L28" sourceLabel="connection.ts:28" />

OS identifier (e.g. "Linux" / "Darwin" / vendor driver name), when known.

<MemberHeading id="shell" depth="3" name="shell" sig="shell: string" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L30" sourceLabel="connection.ts:30" />

Login shell path, when known.

<MemberHeading id="transport" depth="3" name="transport" sig="transport: 'ssh' | 'local' | 'network' | 'http'" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L31" sourceLabel="connection.ts:31" />

<MemberHeading id="user" depth="3" name="user" sig="user: string" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L26" sourceLabel="connection.ts:26" />
