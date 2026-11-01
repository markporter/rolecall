---
title: VarsListResult
kind: interface
longname: module:cli.VarsListResult
---

# VarsListResult

<Signature
  code="interface VarsListResult {
	command: 'vars list';
	declared: { entries: VarManifestEntry[]; file: string }[];
	factsByKind: Record<ConnectionKind, string[]>;
}"
/>

<SourceLink href="/source/src/cli/types-ts/#L191" label="types.ts:191" />

---

## Properties

<MemberHeading id="command" depth="3" name="command" sig="command: 'vars list'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L192" sourceLabel="types.ts:192" />

<MemberHeading id="declared" depth="3" name="declared" sig="declared: { entries: VarManifestEntry[]; file: string }[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L194" sourceLabel="types.ts:194" />

Declared vars/facts grouped by the file that declared them.

<MemberHeading id="factsbykind" depth="3" name="factsByKind" sig="factsByKind: Record<ConnectionKind, string[]>" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L196" sourceLabel="types.ts:196" />

Observable fact keys available per connection kind (built-in + registered plugins).
