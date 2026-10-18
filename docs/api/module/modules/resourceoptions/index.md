---
title: ResourceOptions
kind: interface
longname: module:modules.ResourceOptions
description: Options for {@link module:modules.resource|resource}.
---

# ResourceOptions

<Signature
  code="interface ResourceOptions {
	converge: (args: Record<string, unknown>, ctx: ModuleContext) => ModuleResult | Promise<ModuleResult>;
	describe: (args: Record<string, unknown>, ctx: ModuleContext) => DescribeResult | Promise<DescribeResult>;
	name?: string;
}"
/>

<SourceLink href="/source/src/modules/resource-ts/#L24" label="resource.ts:24" />

Options for [resource](/module/modules/resource).

---

## Properties

<MemberHeading id="converge" depth="3" name="converge" sig="converge: (args: Record<string, unknown>, ctx: ModuleContext) => ModuleResult | Promise<ModuleResult>" />

<MemberMeta sourceHref="/source/src/modules/resource-ts/#L45" sourceLabel="resource.ts:45" />

Mutate toward the desired state. Called only when `describe` reported `inDesired: false` (or when no cache/force bypasses the policy).

<MemberHeading id="describe" depth="3" name="describe" sig="describe: (args: Record<string, unknown>, ctx: ModuleContext) => DescribeResult | Promise<DescribeResult>" />

<MemberMeta sourceHref="/source/src/modules/resource-ts/#L34" sourceLabel="resource.ts:34" />

Observe the current state for the given args and report whether it already matches the desired state. Must be pure read — never mutate.

<MemberHeading id="name" depth="3" name="name" sig="name: string" />

<MemberMeta sourceHref="/source/src/modules/resource-ts/#L26" sourceLabel="resource.ts:26" />

Optional module name; set before registering (defaults to a placeholder).
