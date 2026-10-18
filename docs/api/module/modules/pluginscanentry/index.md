---
title: PluginScanEntry
kind: interface
longname: module:modules.PluginScanEntry
description: One discovered plugin file.
---

# PluginScanEntry

<Signature
  code="interface PluginScanEntry {
	filePath: string;
	fqcn: string;
	name: string;
	namespace: string;
	type: PluginType;
}"
/>

<SourceLink href="/source/src/modules/scanner-ts/#L27" label="scanner.ts:27" />

One discovered plugin file.

---

## Properties

<MemberHeading id="filepath" depth="3" name="filePath" sig="filePath: string" />

<MemberMeta sourceHref="/source/src/modules/scanner-ts/#L37" sourceLabel="scanner.ts:37" />

Absolute path to the source file.

<MemberHeading id="fqcn" depth="3" name="fqcn" sig="fqcn: string" />

<MemberMeta sourceHref="/source/src/modules/scanner-ts/#L29" sourceLabel="scanner.ts:29" />

Fully-qualified name `<namespace>.<name>` (type is NOT included).

<MemberHeading id="name" depth="3" name="name" sig="name: string" />

<MemberMeta sourceHref="/source/src/modules/scanner-ts/#L33" sourceLabel="scanner.ts:33" />

The bare file name (without extension).

<MemberHeading id="namespace" depth="3" name="namespace" sig="namespace: string" />

<MemberMeta sourceHref="/source/src/modules/scanner-ts/#L31" sourceLabel="scanner.ts:31" />

The `<namespace>` directory segment (the collection unit).

<MemberHeading id="type" depth="3" name="type" sig="type: PluginType" />

<MemberMeta sourceHref="/source/src/modules/scanner-ts/#L35" sourceLabel="scanner.ts:35" />

The plugin type, inferred from the directory.
