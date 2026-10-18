---
title: validateJobBody
kind: function
longname: module:orchestrator.validateJobBody
description: Validate + coerce an arbitrary parsed body into a JobBody, or explain why not. forcedType pre-fills type for typed shortcut routes (e.g. POST /webhooks/adhoc).
---

# validateJobBody

<Signature
  code="validateJobBody(
	input: unknown,
	forcedType?: ActionType,
): ValidationResult"
/>

<SourceLink href="/source/src/orchestrator/job-validation-ts/#L94" label="job-validation.ts:94" />

Validate + coerce an arbitrary parsed body into a JobBody, or explain why not. `forcedType` pre-fills `type` for typed shortcut routes (e.g. POST /webhooks/adhoc).

**Parameters**

- `input` (unknown)
- `forcedType` ([ActionType](/module/orchestrator/actiontype), optional)

**Returns**

- [`ValidationResult`](/module/orchestrator/validationresult)
