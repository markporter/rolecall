---
title: VendorDriver
kind: interface
longname: module:transport.VendorDriver
description: "Vendor CLI semantics for network switches: how to enter config mode, show/commit config, etc."
---

# VendorDriver

<Signature
  code="interface VendorDriver {
	enterConfig: string;
	exitConfig: string;
	name: string;
	showRunning: string;
	commit(): string;
	commitConfirmed(seconds: number): string;
	parseRunning?(raw: string): string;
}"
/>

<SourceLink href="/source/src/transport/connection-ts/#L101" label="connection.ts:101" />

Vendor CLI semantics for network switches: how to enter config mode, show/commit config, etc.

---

## Properties

<MemberHeading id="enterconfig" depth="3" name="enterConfig" sig="enterConfig: string" />

<MemberMeta badges="readonly" sourceHref="/source/src/transport/connection-ts/#L104" sourceLabel="connection.ts:104" />

Command that enters configuration mode (privileged EXEC → config).

<MemberHeading id="exitconfig" depth="3" name="exitConfig" sig="exitConfig: string" />

<MemberMeta badges="readonly" sourceHref="/source/src/transport/connection-ts/#L106" sourceLabel="connection.ts:106" />

Command that exits configuration mode back to privileged EXEC.

<MemberHeading id="name" depth="3" name="name" sig="name: string" />

<MemberMeta badges="readonly" sourceHref="/source/src/transport/connection-ts/#L102" sourceLabel="connection.ts:102" />

<MemberHeading id="showrunning" depth="3" name="showRunning" sig="showRunning: string" />

<MemberMeta badges="readonly" sourceHref="/source/src/transport/connection-ts/#L108" sourceLabel="connection.ts:108" />

Command that dumps the running configuration.

## Methods

<MemberHeading id="commit" depth="3" name="commit" sig="commit(): string" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L110" sourceLabel="connection.ts:110" />

Atomic commit of the running configuration.

**Returns**

- `string`

<MemberHeading id="commitconfirmed" depth="3" name="commitConfirmed" sig="commitConfirmed(seconds: number): string" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L112" sourceLabel="connection.ts:112" />

Commit that auto-reverts after `seconds` unless confirmed.

**Parameters**

- `seconds` (number)

**Returns**

- `string`

<MemberHeading id="parserunning" depth="3" name="parseRunning" sig="parseRunning(raw: string): string" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L114" sourceLabel="connection.ts:114" />

Optional post-processing of raw `show running-config` output.

**Parameters**

- `raw` (string)

**Returns**

- `string`
