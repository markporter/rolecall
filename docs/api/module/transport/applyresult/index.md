---
title: ApplyResult
kind: interface
longname: module:transport.ApplyResult
---

# ApplyResult

<Signature
  code="interface ApplyResult {
	added: string[];
	changed: boolean;
	commands: string[];
	committed: boolean;
	removed: string[];
}"
/>

<SourceLink href="/source/src/transport/network-ts/#L42" label="network.ts:42" />

---

## Properties

<MemberHeading id="added" depth="3" name="added" sig="added: string[]" />

<MemberMeta sourceHref="/source/src/transport/network-ts/#L44" sourceLabel="network.ts:44" />

<MemberHeading id="changed" depth="3" name="changed" sig="changed: boolean" />

<MemberMeta sourceHref="/source/src/transport/network-ts/#L43" sourceLabel="network.ts:43" />

<MemberHeading id="commands" depth="3" name="commands" sig="commands: string[]" />

<MemberMeta sourceHref="/source/src/transport/network-ts/#L47" sourceLabel="network.ts:47" />

Every command sent to the device (empty when unchanged).

<MemberHeading id="committed" depth="3" name="committed" sig="committed: boolean" />

<MemberMeta sourceHref="/source/src/transport/network-ts/#L48" sourceLabel="network.ts:48" />

<MemberHeading id="removed" depth="3" name="removed" sig="removed: string[]" />

<MemberMeta sourceHref="/source/src/transport/network-ts/#L45" sourceLabel="network.ts:45" />
