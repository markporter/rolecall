---
title: TemplateRefProblem
kind: interface
longname: module:config.TemplateRefProblem
description: A single template-ref problem found during playbook load.
---

# TemplateRefProblem

<Signature
  code="interface TemplateRefProblem {
	kind: 'jinja' | 'namespace-unknown' | 'undeclared-var' | 'undeclared-fact';
	message: string;
	path: string;
}"
/>

<SourceLink href="/source/src/config/loader-ts/#L115" label="loader.ts:115" />

A single template-ref problem found during playbook load.

---

## Properties

<MemberHeading id="kind" depth="3" name="kind" sig="kind: 'jinja' | 'namespace-unknown' | 'undeclared-var' | 'undeclared-fact'" />

<MemberMeta sourceHref="/source/src/config/loader-ts/#L119" sourceLabel="loader.ts:119" />

`jinja` = raw `{{ }}` delimiter; `namespace-unknown` = `$var` whose first segment is not one of the 9 reserved namespaces; `undeclared-var`/`undeclared-fact` = var_strict enforcement (vars./facts. leaves only).

<MemberHeading id="message" depth="3" name="message" sig="message: string" />

<MemberMeta sourceHref="/source/src/config/loader-ts/#L121" sourceLabel="loader.ts:121" />

Human-readable explanation of the problem.

<MemberHeading id="path" depth="3" name="path" sig="path: string" />

<MemberMeta sourceHref="/source/src/config/loader-ts/#L117" sourceLabel="loader.ts:117" />

Dot/bracket path to the offending value within the playbook.
