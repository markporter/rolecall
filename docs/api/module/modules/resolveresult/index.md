---
title: ResolveResult
kind: typedef
longname: module:modules.ResolveResult
description: Result of resolving a module reference.
---

# ResolveResult

<Signature code="ResolveResult = { entry: PluginScanEntry | null; fqcn: string; kind: 'module'; module: Module } | { kind: 'notFound'; spec: string } | { candidates: string[]; kind: 'ambiguous'; spec: string }" />

<SourceLink href="/source/src/modules/resolver-ts/#L20" label="resolver.ts:20" />

Result of resolving a module reference.
