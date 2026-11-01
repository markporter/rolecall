---
title: DocsModulesResult
kind: interface
longname: module:cli.DocsModulesResult
description: Result of listing RoleCall modules ( rolecall docs modules ).
---

# DocsModulesResult

<Signature
  code="interface DocsModulesResult {
	command: 'docs modules';
	count: number;
	modules: DocsModuleEntry[];
	query: string;
}"
/>

<SourceLink href="/source/src/cli/types-ts/#L180" label="types.ts:180" />

Result of listing RoleCall modules (`rolecall docs modules`).

---

## Properties

<MemberHeading id="command" depth="3" name="command" sig="command: 'docs modules'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L181" sourceLabel="types.ts:181" />

<MemberHeading id="count" depth="3" name="count" sig="count: number" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L185" sourceLabel="types.ts:185" />

Number of modules actually returned (after any filter).

<MemberHeading id="modules" depth="3" name="modules" sig="modules: DocsModuleEntry[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L187" sourceLabel="types.ts:187" />

Ordered module summaries (sorted by name for deterministic output).

<MemberHeading id="query" depth="3" name="query" sig="query: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L183" sourceLabel="types.ts:183" />

The filter term echoed back (empty string when listing all modules).
