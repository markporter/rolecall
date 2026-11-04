---
title: DocsSearchResult
kind: interface
longname: module:cli.DocsSearchResult
description: Result of searching RoleCall's prose documentation ( rolecall docs search ). Hits reuse DocHit.
---

# DocsSearchResult

<Signature
  code="interface DocsSearchResult {
	command: 'docs search';
	count: number;
	hits: DocHit[];
	query: string;
}"
/>

<SourceLink href="/source/src/cli/types-ts/#L205" label="types.ts:205" />

Result of searching RoleCall's prose documentation (`rolecall docs search`). Hits reuse DocHit.

---

## Properties

<MemberHeading id="command" depth="3" name="command" sig="command: 'docs search'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L206" sourceLabel="types.ts:206" />

<MemberHeading id="count" depth="3" name="count" sig="count: number" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L210" sourceLabel="types.ts:210" />

Number of hits actually returned.

<MemberHeading id="hits" depth="3" name="hits" sig="hits: DocHit[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L212" sourceLabel="types.ts:212" />

Ordered hits; most-matching-first, then line ascending.

<MemberHeading id="query" depth="3" name="query" sig="query: string" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L208" sourceLabel="types.ts:208" />

The query term echoed back (trimmed).
