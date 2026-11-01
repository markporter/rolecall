---
title: createConnection
kind: function
longname: module:transport.createConnection
description: Construct a Connection from its discriminated options. The kind field selects the implementer; unknown kinds are a compile-time exhaustiveness error.
---

# createConnection

<Signature code="createConnection(options: ConnectionOptions): Connection" />

<SourceLink href="/source/src/transport/index-ts/#L20" label="index.ts:20" />

Construct a Connection from its discriminated options. The `kind` field selects the implementer; unknown kinds are a compile-time exhaustiveness error.

**Parameters**

- `options` ([ConnectionOptions](/module/transport/connectionoptions))

**Returns**

- [`Connection`](/module/transport/connection)
