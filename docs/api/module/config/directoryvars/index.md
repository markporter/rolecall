---
title: DirectoryVars
kind: interface
longname: module:config.DirectoryVars
description: Parsed group_vars/ + host_vars/ contribution discovered next to an inventory file.
---

# DirectoryVars

<Signature
  code="interface DirectoryVars {
	groupVarsByGroup: Record<string, Record<string, unknown>>;
	hostVarsByHost: Record<string, Record<string, unknown>>;
}"
/>

<SourceLink href="/source/src/config/loader-ts/#L803" label="loader.ts:803" />

Parsed `group_vars/` + `host_vars/` contribution discovered next to an inventory file.

---

## Properties

<MemberHeading id="groupvarsbygroup" depth="3" name="groupVarsByGroup" sig="groupVarsByGroup: Record<string, Record<string, unknown>>" />

<MemberMeta sourceHref="/source/src/config/loader-ts/#L805" sourceLabel="loader.ts:805" />

group name -> var map (file `group_vars/<group>.yaml` becomes group `<group>`).

<MemberHeading id="hostvarsbyhost" depth="3" name="hostVarsByHost" sig="hostVarsByHost: Record<string, Record<string, unknown>>" />

<MemberMeta sourceHref="/source/src/config/loader-ts/#L807" sourceLabel="loader.ts:807" />

host name -> var map (file `host_vars/<host>.yaml` becomes host `<host>`).
