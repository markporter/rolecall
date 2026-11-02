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

<SourceLink href="/source/src/cli/types-ts/#L225" label="types.ts:225" />

---

## Properties

<MemberHeading id="command" depth="3" name="command" sig="command: 'vars list'" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L226" sourceLabel="types.ts:226" />

<MemberHeading id="declared" depth="3" name="declared" sig="declared: { entries: VarManifestEntry[]; file: string }[]" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L228" sourceLabel="types.ts:228" />

Declared vars/facts grouped by the file that declared them.

<MemberHeading id="factsbykind" depth="3" name="factsByKind" sig="factsByKind: Record<ConnectionKind, string[]>" />

<MemberMeta sourceHref="/source/src/cli/types-ts/#L230" sourceLabel="types.ts:230" />

Observable fact keys available per connection kind (built-in + registered plugins).
