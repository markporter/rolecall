---
title: Project
kind: interface
longname: module:store.Project
description: A persisted Project row.
---

# Project

<Signature
  code="interface Project {
	createdAt: number;
	history: unknown[];
	id: string;
	inventoryRef?: string;
	path: string;
	playbookRef?: string;
	updatedAt: number;
	vars: Record<string, unknown>;
}"
/>

<SourceLink href="/source/src/store/types-ts/#L15" label="types.ts:15" />

A persisted Project row.

---

## Properties

<MemberHeading id="createdat" depth="3" name="createdAt" sig="createdAt: number" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L23" sourceLabel="types.ts:23" />

<MemberHeading id="history" depth="3" name="history" sig="history: unknown[]" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L22" sourceLabel="types.ts:22" />

<MemberHeading id="id" depth="3" name="id" sig="id: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L16" sourceLabel="types.ts:16" />

<MemberHeading id="inventoryref" depth="3" name="inventoryRef" sig="inventoryRef: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L19" sourceLabel="types.ts:19" />

<MemberHeading id="path" depth="3" name="path" sig="path: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L18" sourceLabel="types.ts:18" />

Absolute filesystem path this project governs.

<MemberHeading id="playbookref" depth="3" name="playbookRef" sig="playbookRef: string" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L20" sourceLabel="types.ts:20" />

<MemberHeading id="updatedat" depth="3" name="updatedAt" sig="updatedAt: number" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L24" sourceLabel="types.ts:24" />

<MemberHeading id="vars" depth="3" name="vars" sig="vars: Record<string, unknown>" />

<MemberMeta sourceHref="/source/src/store/types-ts/#L21" sourceLabel="types.ts:21" />
