---
title: FactCache
kind: interface
longname: module:facts.FactCache
---

# FactCache

<Signature
  code="interface FactCache {
	clear(): Promise<void>;
	get(host: string, keys: readonly string[]): Promise<FactMap | undefined>;
	set(host: string, keys: readonly string[], facts: FactMap): Promise<void>;
	size(): Promise<number>;
}"
/>

<SourceLink href="/source/src/facts/cache-ts/#L12" label="cache.ts:12" />

---

## Methods

<MemberHeading id="clear" depth="3" name="clear" sig="clear(): Promise<void>" />

<MemberMeta badges="async" sourceHref="/source/src/facts/cache-ts/#L18" sourceLabel="cache.ts:18" />

Drop all entries.

**Returns**

- `Promise<void>`

<MemberHeading
  id="get"
  depth="3"
  name="get"
  sig="get(
	host: string,
	keys: readonly string[],
): Promise<FactMap | undefined>"
/>

<MemberMeta badges="async" sourceHref="/source/src/facts/cache-ts/#L14" sourceLabel="cache.ts:14" />

Return the cached fact map for host+keys, or undefined on miss/expiry.

**Parameters**

- `host` (string)
- `keys` (readonly string\[])

**Returns**

- `Promise<`[`FactMap`](/module/facts/factmap)` | undefined>`

<MemberHeading
  id="set"
  depth="3"
  name="set"
  sig="set(
	host: string,
	keys: readonly string[],
	facts: FactMap,
): Promise<void>"
/>

<MemberMeta badges="async" sourceHref="/source/src/facts/cache-ts/#L16" sourceLabel="cache.ts:16" />

Store a fact map for host+keys with the configured TTL.

**Parameters**

- `host` (string)
- `keys` (readonly string\[])
- `facts` ([FactMap](/module/facts/factmap))

**Returns**

- `Promise<void>`

<MemberHeading id="size" depth="3" name="size" sig="size(): Promise<number>" />

<MemberMeta badges="async" sourceHref="/source/src/facts/cache-ts/#L20" sourceLabel="cache.ts:20" />

Count of live (non-expired) entries — observability / tests.

**Returns**

- `Promise<number>`
