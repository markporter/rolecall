---
title: loadPlaybook
kind: function
longname: module:config.loadPlaybook
description: Parse + validate raw playbook YAML text into a normalized array of plays. The document root MUST be a top-level list of plays; a bare single-play object is rejected with a list-required error. Template-ref problems ( {{ }} / unprefixed $var ) are hard errors that fail closed; every expanded/imported file is linted at its own load.
---

# loadPlaybook

<Signature code="loadPlaybook(yaml: string): NormalizedPlaybook[]" />

<SourceLink href="/source/src/config/loader-ts/#L271" label="loader.ts:271" />

Parse + validate raw playbook YAML text into a normalized array of plays. The document root MUST be a top-level list of plays; a bare single-play object is rejected with a list-required error. Template-ref problems (`{{ }}` / unprefixed `$var`) are hard errors that fail closed; every expanded/imported file is linted at its own load.

**Parameters**

- `yaml` (string) — Raw playbook YAML text (a top-level list of plays).

**Returns**

- [`NormalizedPlaybook`](/module/config/normalizedplaybook)`[]` — The normalized array of plays.

**Throws**

- When the YAML fails schema validation (incl. a bare play object).
- When a template-ref problem is detected.
