---
title: ServeConfig
kind: interface
longname: module:config.ServeConfig
description: Settings controlling how rolecall --serve binds its HTTP listener. Numeric/host fields stay optional so each caller keeps its own fallback default.
---

# ServeConfig

<Signature
  code="interface ServeConfig {
	host?: string;
	port?: number;
	uiDist?: string;
}"
/>

<SourceLink href="/source/src/config/env-ts/#L22" label="env.ts:22" />

Settings controlling how `rolecall --serve` binds its HTTP listener. Numeric/host fields stay optional so each caller keeps its own fallback default.

---

## Properties

<MemberHeading id="host" depth="3" name="host" sig="host: string" />

<MemberMeta sourceHref="/source/src/config/env-ts/#L26" sourceLabel="env.ts:26" />

Listen host (ROLECALL_SERVE_HOST). Undefined => caller applies its string default ("127.0.0.1").

<MemberHeading id="port" depth="3" name="port" sig="port: number" />

<MemberMeta sourceHref="/source/src/config/env-ts/#L24" sourceLabel="env.ts:24" />

Listen port (ROLECALL_SERVE_PORT). Undefined => caller applies its numeric default (8080).

<MemberHeading id="uidist" depth="3" name="uiDist" sig="uiDist: string" />

<MemberMeta sourceHref="/source/src/config/env-ts/#L28" sourceLabel="env.ts:28" />

Static UI directory to serve (ROLECALL_UI_DIST, plus legacy ROLECALL_SERVE_UI_DIST fallback). Undefined => zero-build mode.
