---
title: loadConfig
kind: function
longname: module:config.loadConfig
description: Read RoleCall's environment variables and merge them over safe built-in defaults.
---

# loadConfig

<Signature code="loadConfig(): Config" />

<SourceLink href="/source/src/config/env-ts/#L84" label="env.ts:84" />

Read RoleCall's environment variables and merge them over safe built-in defaults.

**Returns**

- [`Config`](/module/config/config) — A fully-typed Config in which every scalar field resolves without undefined even when all vars are unset.
