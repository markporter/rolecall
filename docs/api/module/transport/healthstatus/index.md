---
title: HealthStatus
kind: interface
longname: module:transport.HealthStatus
---

# HealthStatus

<Signature
  code="interface HealthStatus {
	error?: string;
	latencyMs?: number;
	ok: boolean;
}"
/>

<SourceLink href="/source/src/transport/connection-ts/#L34" label="connection.ts:34" />

---

## Properties

<MemberHeading id="error" depth="3" name="error" sig="error: string" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L38" sourceLabel="connection.ts:38" />

<MemberHeading id="latencyms" depth="3" name="latencyMs" sig="latencyMs: number" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L37" sourceLabel="connection.ts:37" />

Round-trip latency in milliseconds, when ok.

<MemberHeading id="ok" depth="3" name="ok" sig="ok: boolean" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L35" sourceLabel="connection.ts:35" />
