---
title: verifyHostKey
kind: function
longname: module:transport.verifyHostKey
description: True iff host has a known_hosts entry whose key body (modulus/key material, independent of the recorded algorithm name) matches the presented key .
---

# verifyHostKey

<Signature
  code="verifyHostKey(
	host: string,
	key: Buffer,
	knownHostsPath?: string,
): boolean"
/>

<SourceLink href="/source/src/transport/ssh-ts/#L92" label="ssh.ts:92" />

True iff `host` has a known_hosts entry whose key body (modulus/key material, independent of the recorded algorithm name) matches the presented `key`.

**Parameters**

- `host` (string)
- `key` (Buffer)
- `knownHostsPath` (string, optional)

**Returns**

- `boolean`
