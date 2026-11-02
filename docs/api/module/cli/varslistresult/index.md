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

<SourceLink href="/source/src/cli/types-ts/#L217" label="types.ts:217" />

---

## Properties

<MemberHeading id="command" depth="3" name="command" sig="command: 'vars list'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L218" sourceLabel="types.ts:218" />

<MemberHeading id="declared" depth="3" name="declared" sig="declared: { entries: VarManifestEntry[]; file: string }[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L220" sourceLabel="types.ts:220" />

Declared vars/facts grouped by the file that declared them.

<MemberHeading id="factsbykind" depth="3" name="factsByKind" sig="factsByKind: Record<ConnectionKind, string[]>" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L222" sourceLabel="types.ts:222" />

Observable fact keys available per connection kind (built-in + registered plugins).
