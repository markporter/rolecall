---
title: ModuleSummary
kind: interface
longname: module:modules.ModuleSummary
description: Serializable summary of a registered module, returned by searchModules .
---

# ModuleSummary

<Signature
  code="interface ModuleSummary {
	args?: Record<string, { description: string; required: boolean; type: string }>;
	description: string;
	examples?: string[];
	idempotent?: boolean;
	name: string;
	notes?: string;
	source?: string;
}"
/>

<SourceLink href="/source/src/modules/search-ts/#L12" label="search.ts:12" />

Serializable summary of a registered module, returned by `searchModules`.

---

## Properties

<MemberHeading id="args" depth="3" name="args" sig="args: Record<string, { description: string; required: boolean; type: string }>" />

<MemberMeta sourceHref="/source/src/modules/search-ts/#L22" sourceLabel="search.ts:22" />

Optional per-argument metadata for the module.

<MemberHeading id="description" depth="3" name="description" sig="description: string" />

<MemberMeta sourceHref="/source/src/modules/search-ts/#L16" sourceLabel="search.ts:16" />

Human-readable one-line description.

<MemberHeading id="examples" depth="3" name="examples" sig="examples: string[]" />

<MemberMeta sourceHref="/source/src/modules/search-ts/#L24" sourceLabel="search.ts:24" />

Optional usage examples (e.g. task snippets).

<MemberHeading id="idempotent" depth="3" name="idempotent" sig="idempotent: boolean" />

<MemberMeta sourceHref="/source/src/modules/search-ts/#L18" sourceLabel="search.ts:18" />

True when the module implements an idempotent `check` (CheckableModule).

<MemberHeading id="name" depth="3" name="name" sig="name: string" />

<MemberMeta sourceHref="/source/src/modules/search-ts/#L14" sourceLabel="search.ts:14" />

Module name (dispatched via `module:` in a task).

<MemberHeading id="notes" depth="3" name="notes" sig="notes: string" />

<MemberMeta sourceHref="/source/src/modules/search-ts/#L30" sourceLabel="search.ts:30" />

Optional "≠ Ansible" callout noting where this module's semantics differ from the Ansible module it most resembles (rendered as a callout block under each module in the generated reference). Omit when there is nothing notable.

<MemberHeading id="source" depth="3" name="source" sig="source: string" />

<MemberMeta sourceHref="/source/src/modules/search-ts/#L20" sourceLabel="search.ts:20" />

Provenance: "builtin" | "plugin" | "user" | "example".
