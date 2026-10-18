---
title: ApplyOptions
kind: interface
longname: module:transport.ApplyOptions
---

# ApplyOptions

<Signature
  code="interface ApplyOptions {
	commit?: boolean;
	mode?: 'replace' | 'merge';
	revertInSeconds?: number;
}"
/>

<SourceLink href="/source/src/transport/network-ts/#L33" label="network.ts:33" />

---

## Properties

<MemberHeading id="commit" depth="3" name="commit" sig="commit: boolean" />

<MemberMeta sourceHref="/source/src/transport/network-ts/#L39" sourceLabel="network.ts:39" />

Skip the commit step (dry-run the diff + apply). Default false.

<MemberHeading id="mode" depth="3" name="mode" sig="mode: 'replace' | 'merge'" />

<MemberMeta sourceHref="/source/src/transport/network-ts/#L35" sourceLabel="network.ts:35" />

"merge" applies only the diff delta; "replace" applies the whole candidate.

<MemberHeading id="revertinseconds" depth="3" name="revertInSeconds" sig="revertInSeconds: number" />

<MemberMeta sourceHref="/source/src/transport/network-ts/#L37" sourceLabel="network.ts:37" />

Arm a device-side revert timer (seconds). Requires a confirmed commit.
