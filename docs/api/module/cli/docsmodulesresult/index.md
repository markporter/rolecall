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

<SourceLink href="/source/src/cli/types-ts/#L218" label="types.ts:218" />

Result of listing RoleCall modules (`rolecall docs modules`).

---

## Properties

<MemberHeading id="command" depth="3" name="command" sig="command: 'docs modules'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L219" sourceLabel="types.ts:219" />

<MemberHeading id="count" depth="3" name="count" sig="count: number" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L223" sourceLabel="types.ts:223" />

Number of modules actually returned (after any filter).

<MemberHeading id="modules" depth="3" name="modules" sig="modules: DocsModuleEntry[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L225" sourceLabel="types.ts:225" />

Ordered module summaries (sorted by name for deterministic output).

<MemberHeading id="query" depth="3" name="query" sig="query: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L221" sourceLabel="types.ts:221" />

The filter term echoed back (empty string when listing all modules).
