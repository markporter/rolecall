---
title: JobBody
kind: interface
longname: module:orchestrator.JobBody
description: Body of POST /run. Enough to resolve targets + execute against sims.
---

# JobBody

<Signature
  code="interface JobBody {
	args?: Record<string, unknown>;
	config?: string;
	force?: boolean;
	hosts?: string[];
	inventory?: NormalizedInventory;
	inventoryPath?: string;
	limit?: string;
	module?: string;
	playbook?: NormalizedPlaybookFile;
	playbookPath?: string;
	targets?: string[];
	tasks?: PlanTask[];
	type: ActionType;
}"
/>

<SourceLink href="/source/src/orchestrator/types-ts/#L56" label="types.ts:56" />

Body of POST /run. Enough to resolve targets + execute against sims.

---

## Properties

<MemberHeading id="args" depth="3" name="args" sig="args: Record<string, unknown>" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L74" sourceLabel="types.ts:74" />

Generic module arguments forwarded per-target.

<MemberHeading id="config" depth="3" name="config" sig="config: string" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L72" sourceLabel="types.ts:72" />

Desired state pushed by set_config-style modules (esp. network).

<MemberHeading id="force" depth="3" name="force" sig="force: boolean" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L76" sourceLabel="types.ts:76" />

Fire-and-forget: always apply even if already in desired state.

<MemberHeading id="hosts" depth="3" name="hosts" sig="hosts: string[]" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L61" sourceLabel="types.ts:61" />

Target patterns when resolving through an inventory.

<MemberHeading id="inventory" depth="3" name="inventory" sig="inventory: NormalizedInventory" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L70" sourceLabel="types.ts:70" />

Inline parsed inventory (alternative to inventory/inventoryPath).

<MemberHeading id="inventorypath" depth="3" name="inventoryPath" sig="inventoryPath: string" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L80" sourceLabel="types.ts:80" />

Load inventory from this YAML file path (reuses src/config loaders verbatim).

<MemberHeading id="limit" depth="3" name="limit" sig="limit: string" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L62" sourceLabel="types.ts:62" />

<MemberHeading id="module" depth="3" name="module" sig="module: string" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L64" sourceLabel="types.ts:64" />

Ad-hoc module name (e.g. "ping", "command").

<MemberHeading id="playbook" depth="3" name="playbook" sig="playbook: NormalizedPlaybookFile" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L68" sourceLabel="types.ts:68" />

Inline parsed playbook (alternative to playbook/playbookPath). A playbook file may be a single play or a list of plays.

<MemberHeading id="playbookpath" depth="3" name="playbookPath" sig="playbookPath: string" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L78" sourceLabel="types.ts:78" />

Load playbook from this YAML file path (reuses src/config loaders verbatim).

<MemberHeading id="targets" depth="3" name="targets" sig="targets: string[]" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L59" sourceLabel="types.ts:59" />

Explicit target names/patterns over the fleet (default: all).

<MemberHeading id="tasks" depth="3" name="tasks" sig="tasks: PlanTask[]" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L66" sourceLabel="types.ts:66" />

Inline playbook tasks (alternative to playbook/playbookPath).

<MemberHeading id="type" depth="3" name="type" sig="type: ActionType" />

<MemberMeta sourceHref="/source/src/orchestrator/types-ts/#L57" sourceLabel="types.ts:57" />
