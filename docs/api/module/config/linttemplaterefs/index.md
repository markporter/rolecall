---
title: lintTemplateRefs
kind: function
longname: module:config.lintTemplateRefs
description: "Inspect a normalized playbook for unsupported template constructs and return problems. Unlike {@link module:config.lintPlaybookIdempotency|lintPlaybookIdempotency} these are hard errors: callers should throw. Scans task scalar args, when , loop , notify , and names; the vars data namespace is intentionally skipped (it holds literal values)."
---

# lintTemplateRefs

<Signature code="lintTemplateRefs(pb: NormalizedPlaybook): TemplateRefProblem[]" />

<SourceLink href="/source/src/config/loader-ts/#L146" label="loader.ts:146" />

Inspect a normalized playbook for unsupported template constructs and return problems. Unlike [lintPlaybookIdempotency](/module/config/lintplaybookidempotency) these are hard errors: callers should throw. Scans task scalar args, `when`, `loop`, `notify`, and names; the `vars` data namespace is intentionally skipped (it holds literal values).

**Parameters**

- `pb` ([NormalizedPlaybook](/module/config/normalizedplaybook)) — Normalized playbook model.

**Returns**

- [`TemplateRefProblem`](/module/config/templaterefproblem)`[]` — Zero or more template-ref problems.
