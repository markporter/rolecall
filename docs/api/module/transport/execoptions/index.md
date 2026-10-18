---
title: ExecOptions
kind: interface
longname: module:transport.ExecOptions
---

# ExecOptions

<Signature
  code="interface ExecOptions {
	cwd?: string;
	env?: Record<string, string | undefined>;
	signal?: AbortSignal;
	timeoutMs?: number;
}"
/>

<SourceLink href="/source/src/transport/connection-ts/#L64" label="connection.ts:64" />

---

## Properties

<MemberHeading id="cwd" depth="3" name="cwd" sig="cwd: string" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L65" sourceLabel="connection.ts:65" />

<MemberHeading id="env" depth="3" name="env" sig="env: Record<string, string | undefined>" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L66" sourceLabel="connection.ts:66" />

<MemberHeading id="signal" depth="3" name="signal" sig="signal: AbortSignal" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L70" sourceLabel="connection.ts:70" />

Abort signal; aborting cancels the in-flight attempt.

<MemberHeading id="timeoutms" depth="3" name="timeoutMs" sig="timeoutMs: number" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L68" sourceLabel="connection.ts:68" />

Per-call hard timeout in ms; overrides the connection default.
