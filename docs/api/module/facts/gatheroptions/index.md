---
title: GatherOptions
kind: interface
longname: module:facts.GatherOptions
description: Options controlling a single gather call.
---

# GatherOptions

<Signature
  code="interface GatherOptions {
	force?: boolean;
	host?: string;
	signal?: AbortSignal;
	throwOnError?: boolean;
	ttlMs?: number;
}"
/>

<SourceLink href="/source/src/facts/types-ts/#L21" label="types.ts:21" />

Options controlling a single gather call.

---

## Properties

<MemberHeading id="force" depth="3" name="force" sig="force: boolean" />

<MemberMeta sourceHref="/source/src/facts/types-ts/#L27" sourceLabel="types.ts:27" />

Skip the cache and force a fresh gather.

<MemberHeading id="host" depth="3" name="host" sig="host: string" />

<MemberMeta sourceHref="/source/src/facts/types-ts/#L23" sourceLabel="types.ts:23" />

Explicit host id used for the cache key (else derived from the connection).

<MemberHeading id="signal" depth="3" name="signal" sig="signal: AbortSignal" />

<MemberMeta sourceHref="/source/src/facts/types-ts/#L29" sourceLabel="types.ts:29" />

Abort signal propagated to transport calls.

<MemberHeading id="throwonerror" depth="3" name="throwOnError" sig="throwOnError: boolean" />

<MemberMeta sourceHref="/source/src/facts/types-ts/#L34" sourceLabel="types.ts:34" />

When true, a gatherer failure throws a typed `FactError` instead of being skipped. Default false => graceful partial result (missing keys omitted).

<MemberHeading id="ttlms" depth="3" name="ttlMs" sig="ttlMs: number" />

<MemberMeta sourceHref="/source/src/facts/types-ts/#L25" sourceLabel="types.ts:25" />

Cache TTL in ms. Default 60_000. Ignored when `force` is set.
