---
title: IdempotencyWarning
kind: interface
longname: module:config.IdempotencyWarning
description: A single idempotency warning emitted during playbook load/normalize.
---

# IdempotencyWarning

<Signature
  code="interface IdempotencyWarning {
	module: string;
	task: string;
	warning: string;
}"
/>

<SourceLink href="/source/src/config/loader-ts/#L80" label="loader.ts:80" />

A single idempotency warning emitted during playbook load/normalize.

---

## Properties

<MemberHeading id="module" depth="3" name="module" sig="module: string" />

<MemberMeta sourceHref="/source/src/config/loader-ts/#L82" sourceLabel="loader.ts:82" />

<MemberHeading id="task" depth="3" name="task" sig="task: string" />

<MemberMeta sourceHref="/source/src/config/loader-ts/#L81" sourceLabel="loader.ts:81" />

<MemberHeading id="warning" depth="3" name="warning" sig="warning: string" />

<MemberMeta sourceHref="/source/src/config/loader-ts/#L83" sourceLabel="loader.ts:83" />
