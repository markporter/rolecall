---
title: DescribeResult
kind: interface
longname: module:modules.DescribeResult
description: Observed-vs-desired probe returned by a resource describe function.
---

# DescribeResult

<Signature
  code="interface DescribeResult {
	current: unknown;
	inDesired: boolean;
}"
/>

<SourceLink href="/source/src/modules/resource-ts/#L16" label="resource.ts:16" />

Observed-vs-desired probe returned by a resource `describe` function.

---

## Properties

<MemberHeading id="current" depth="3" name="current" sig="current: unknown" />

<MemberMeta sourceHref="/source/src/modules/resource-ts/#L18" sourceLabel="resource.ts:18" />

Snapshot of the currently-observed state (any serializable value).

<MemberHeading id="indesired" depth="3" name="inDesired" sig="inDesired: boolean" />

<MemberMeta sourceHref="/source/src/modules/resource-ts/#L20" sourceLabel="resource.ts:20" />

True when the observed state already equals the desired args.
