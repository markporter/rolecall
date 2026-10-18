---
title: UpdateProjectPatch
kind: interface
longname: module:store.UpdateProjectPatch
description: Patch applied to an existing project; provided fields replace/merge.
---

# UpdateProjectPatch

<Signature
  code="interface UpdateProjectPatch {
	history?: unknown[];
	inventoryRef?: string;
	path?: string;
	playbookRef?: string;
	vars?: Record<string, unknown>;
}"
/>

<SourceLink href="/source/src/store/types-ts/#L37" label="types.ts:37" />

Patch applied to an existing project; provided fields replace/merge.

---

## Properties

<MemberHeading id="history" depth="3" name="history" sig="history: unknown[]" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L43" sourceLabel="types.ts:43" />

Appended to the existing history array rather than replacing it.

<MemberHeading id="inventoryref" depth="3" name="inventoryRef" sig="inventoryRef: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L39" sourceLabel="types.ts:39" />

<MemberHeading id="path" depth="3" name="path" sig="path: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L38" sourceLabel="types.ts:38" />

<MemberHeading id="playbookref" depth="3" name="playbookRef" sig="playbookRef: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L40" sourceLabel="types.ts:40" />

<MemberHeading id="vars" depth="3" name="vars" sig="vars: Record<string, unknown>" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L41" sourceLabel="types.ts:41" />
