---
title: WriteQueue
kind: class
longname: module:store.WriteQueue
---

# WriteQueue

<SourceLink href="/source/src/store/write-chain-ts/#L12" label="write-chain.ts:12" />

---

## Constructors

<MemberHeading id="constructor" depth="3" name="constructor" sig="new WriteQueue(): WriteQueue" />

**Returns**

`WriteQueue`

---

## Accessors

<MemberHeading id="pending" depth="3" name="pending" sig="get pending(): number" />

<MemberMeta sourceHref="/source/src/store/write-chain-ts/#L47" sourceLabel="write-chain.ts:47" />

Number of mutations still waiting behind the active one.

## Methods

<MemberHeading id="enqueue" depth="3" name="enqueue" sig="enqueue" />

<MemberMeta badges="async" sourceHref="/source/src/store/write-chain-ts/#L17" sourceLabel="write-chain.ts:17" />

Enqueue a mutation; returns a promise resolving when it has committed.

<Signature code="enqueue(task: () => Promise<void>): Promise<void>" />

**Parameters**

- `task` (() => Promise\<void>)

**Returns**

- `Promise<void>`

<Signature code="enqueue<T>(task: () => Promise<T>): Promise<T>" />

Enqueue a mutation; returns a promise resolving when it has committed.

**Type Parameters**

- `T`

**Parameters**

- `task` (() => Promise\<T>)

**Returns**

- `Promise<T>`
