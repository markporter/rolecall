---
title: ConfigDiff
kind: interface
longname: module:transport.ConfigDiff
---

# ConfigDiff

<Signature
  code="interface ConfigDiff {
	added: string[];
	changed: boolean;
	changes: Change[];
	removed: string[];
}"
/>

<SourceLink href="/source/src/transport/diff-ts/#L9" label="diff.ts:9" />

---

## Properties

<MemberHeading id="added" depth="3" name="added" sig="added: string[]" />

<MemberMeta sourceHref="/source/src/transport/diff-ts/#L13" sourceLabel="diff.ts:13" />

Lines present in candidate but not running (the delta to merge in).

<MemberHeading id="changed" depth="3" name="changed" sig="changed: boolean" />

<MemberMeta sourceHref="/source/src/transport/diff-ts/#L11" sourceLabel="diff.ts:11" />

True when candidate and running differ after normalization.

<MemberHeading id="changes" depth="3" name="changes" sig="changes: Change[]" />

<MemberMeta sourceHref="/source/src/transport/diff-ts/#L17" sourceLabel="diff.ts:17" />

Raw change objects from `diffLines` (old=running, new=candidate).

<MemberHeading id="removed" depth="3" name="removed" sig="removed: string[]" />

<MemberMeta sourceHref="/source/src/transport/diff-ts/#L15" sourceLabel="diff.ts:15" />

Lines present in running but not candidate (removed by a merge).
