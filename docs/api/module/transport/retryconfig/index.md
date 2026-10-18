---
title: RetryConfig
kind: interface
longname: module:transport.RetryConfig
---

# RetryConfig

<Signature
  code="interface RetryConfig {
	factor: number;
	maxTimeout: number;
	minTimeout: number;
	randomize: boolean;
	retries: number;
}"
/>

<SourceLink href="/source/src/transport/connection-ts/#L51" label="connection.ts:51" />

---

## Properties

<MemberHeading id="factor" depth="3" name="factor" sig="factor: number" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L59" sourceLabel="connection.ts:59" />

Exponential factor applied to successive backoffs.

<MemberHeading id="maxtimeout" depth="3" name="maxTimeout" sig="maxTimeout: number" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L57" sourceLabel="connection.ts:57" />

Upper bound on a single backoff in ms.

<MemberHeading id="mintimeout" depth="3" name="minTimeout" sig="minTimeout: number" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L55" sourceLabel="connection.ts:55" />

Base backoff in ms before the first retry.

<MemberHeading id="randomize" depth="3" name="randomize" sig="randomize: boolean" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L61" sourceLabel="connection.ts:61" />

Add jitter (×1..2) to backoffs to avoid thundering herds.

<MemberHeading id="retries" depth="3" name="retries" sig="retries: number" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L53" sourceLabel="connection.ts:53" />

Max retry attempts after the first failure.
