---
title: ShutdownOptions
kind: interface
longname: module:orchestrator.ShutdownOptions
---

# ShutdownOptions

<Signature
  code="interface ShutdownOptions {
	drainMs?: number;
}"
/>

<SourceLink href="/source/src/orchestrator/shutdown-ts/#L9" label="shutdown.ts:9" />

---

## Properties

<MemberHeading id="drainms" depth="3" name="drainMs" sig="drainMs: number" />

<MemberMeta sourceHref="/source/src/orchestrator/shutdown-ts/#L11" sourceLabel="shutdown.ts:11" />

Max ms to wait for in-flight runs before forcing teardown. Default 3000.
