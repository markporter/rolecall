---
title: loadPlaybook
kind: function
longname: module:config.loadPlaybook
description: Parse + validate raw playbook YAML text into a normalized array of plays. Template-ref problems ( {{ }} / unprefixed $var ) are hard errors that fail closed; every expanded/imported file is linted at its own load.
---

# loadPlaybook

<Signature code="loadPlaybook(yaml: string): NormalizedPlaybook[]" />

<SourceLink href="/source/src/config/loader-ts/#L258" label="loader.ts:258" />

Parse + validate raw playbook YAML text into a normalized array of plays. Template-ref problems (`{{ }}` / unprefixed `$var`) are hard errors that fail closed; every expanded/imported file is linted at its own load.

**Parameters**

- `yaml` (string) — Raw playbook YAML text (a single play object or a top-level list of plays).

**Returns**

- [`NormalizedPlaybook`](/module/config/normalizedplaybook)`[]` — The normalized array of plays (a single object becomes a 1-element array).

**Throws**

- When the YAML fails schema validation.
- When a template-ref problem is detected.
