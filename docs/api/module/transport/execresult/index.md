---
title: ExecResult
kind: interface
longname: module:transport.ExecResult
---

# ExecResult

<Signature
  code="interface ExecResult {
	exitCode: number | null;
	stderr: string;
	stdout: string;
}"
/>

<SourceLink href="/source/src/transport/connection-ts/#L17" label="connection.ts:17" />

---

## Properties

<MemberHeading id="exitcode" depth="3" name="exitCode" sig="exitCode: number | null" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L19" sourceLabel="connection.ts:19" />

Process exit code, or null when the channel closed without a code.

<MemberHeading id="stderr" depth="3" name="stderr" sig="stderr: string" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L21" sourceLabel="connection.ts:21" />

<MemberHeading id="stdout" depth="3" name="stdout" sig="stdout: string" />

<MemberMeta sourceHref="/source/src/transport/connection-ts/#L20" sourceLabel="connection.ts:20" />
