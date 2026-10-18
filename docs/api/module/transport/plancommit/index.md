---
title: planCommit
kind: function
longname: module:transport.planCommit
description: Plan a commit command, optionally arming a device-side revert timer.
---

# planCommit

<Signature
  code="planCommit(
	driver: VendorDriver,
	revertInSeconds?: number,
): { command: string; revertInSeconds?: number; reverts: boolean }"
/>

<SourceLink href="/source/src/transport/network-ts/#L52" label="network.ts:52" />

Plan a commit command, optionally arming a device-side revert timer.

**Parameters**

- `driver` ([VendorDriver](/module/transport/vendordriver))
- `revertInSeconds` (number, optional)

**Properties**

- `command` (string)
- `revertInSeconds` (number, optional)
- `reverts` (boolean)

**Returns**

- `{ command: string; `[`revertInSeconds`](/module/transport/applyoptions#revertinseconds)`?: number; reverts: boolean }`
