---
title: loadConfig
kind: function
longname: module:config.loadConfig
description: "Read RoleCall's environment variables and merge them over safe built-in defaults. Precedence (low → high): system rolecall.env → user rolecall.env → project .rolecall/rolecall.env → process environment. Missing files are ignored; process environment always wins."
---

# loadConfig

<Signature code="loadConfig(options: LoadConfigOptions): Config" />

<SourceLink href="/source/src/config/env-ts/#L118" label="env.ts:118" />

Read RoleCall's environment variables and merge them over safe built-in defaults.

Precedence (low → high): system `rolecall.env` → user `rolecall.env` → project `.rolecall/rolecall.env` → process environment. Missing files are ignored; process environment always wins.

**Parameters**

- `options` ([LoadConfigOptions](/module/config/loadconfigoptions), default: "{}")

**Returns**

- [`Config`](/module/config/config) — A fully-typed Config in which every scalar field resolves without undefined even when all vars are unset.
