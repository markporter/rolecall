---
title: NormalizedPlaybook
kind: interface
longname: module:config.NormalizedPlaybook
---

# NormalizedPlaybook

<Signature
  code="interface NormalizedPlaybook {
	appliedRoleNames?: string[];
	checkpoint?: string;
	hosts: string[];
	imports?: string[];
	name?: string;
	roleDefaults?: Record<string, unknown>;
	roles?: string[];
	serial?: number;
	strategy?: 'linear' | 'free';
	tags?: string[];
	tasks: NormalizedTask[];
	trigger?: { spec: string; type: 'cron' } | { path?: string; type: 'webhook' };
	tx?: string;
	var_strict?: boolean;
	varManifests?: VarManifestEntry[];
	varOrigins?: VarOriginMap;
	vars: Record<string, unknown>;
}"
/>

<SourceLink href="/source/src/config/schema-ts/#L351" label="schema.ts:351" />

---

## Properties

<MemberHeading id="appliedrolenames" depth="3" name="appliedRoleNames" sig="appliedRoleNames: string[]" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L376" sourceLabel="schema.ts:376" />

Names of roles applied to this play (post-expansion), preserved for the `play.roles` namespace (ADR 0013 §6) after `roles` is cleared.

<MemberHeading id="checkpoint" depth="3" name="checkpoint" sig="checkpoint: string" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L368" sourceLabel="schema.ts:368" />

Checkpoint id this play applies under (Todo 26).

<MemberHeading id="hosts" depth="3" name="hosts" sig="hosts: string[]" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L353" sourceLabel="schema.ts:353" />

<MemberHeading id="imports" depth="3" name="imports" sig="imports: string[]" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L356" sourceLabel="schema.ts:356" />

Optional `imports` directives (load-time expansion); absent after expansion.

<MemberHeading id="name" depth="3" name="name" sig="name: string" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L352" sourceLabel="schema.ts:352" />

<MemberHeading id="roledefaults" depth="3" name="roleDefaults" sig="roleDefaults: Record<string, unknown>" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L374" sourceLabel="schema.ts:374" />

Role defaults (lowest precedence tier), kept separate from `vars` so the executor can layer it below inventory host/group vars.

<MemberHeading id="roles" depth="3" name="roles" sig="roles: string[]" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L358" sourceLabel="schema.ts:358" />

Roles composed into this play at load time; empty once expanded away.

<MemberHeading id="serial" depth="3" name="serial" sig="serial: number" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L363" sourceLabel="schema.ts:363" />

<MemberHeading id="strategy" depth="3" name="strategy" sig="strategy: 'linear' | 'free'" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L364" sourceLabel="schema.ts:364" />

<MemberHeading id="tags" depth="3" name="tags" sig="tags: string[]" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L361" sourceLabel="schema.ts:361" />

Play-wide tags inherited by every task lacking its own `tags:`; selected at run time by the global `--tags` / `--skip-tags` flags.

<MemberHeading id="tasks" depth="3" name="tasks" sig="tasks: NormalizedTask[]" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L354" sourceLabel="schema.ts:354" />

<MemberHeading id="trigger" depth="3" name="trigger" sig="trigger: { spec: string; type: 'cron' } | { path?: string; type: 'webhook' }" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L362" sourceLabel="schema.ts:362" />

<MemberHeading id="tx" depth="3" name="tx" sig="tx: string" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L366" sourceLabel="schema.ts:366" />

Transaction id grouping dependent plays for rollback (Todo 26).

<MemberHeading id="varstrict" depth="3" name="var_strict" sig="var_strict: boolean" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L372" sourceLabel="schema.ts:372" />

When true (the default), `$var` references must use a known namespace (`vars.`/`facts.` by default) and resolve to a declared manifest entry (var_strict). Set false to permit undeclared references.

<MemberHeading id="varmanifests" depth="3" name="varManifests" sig="varManifests: VarManifestEntry[]" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L370" sourceLabel="schema.ts:370" />

Declared variable manifests collected for this play (role defaults manifests + playbook-root manifest), used by later phases for strict var validation and resolution. Absent until the loader discovers manifests.

<MemberHeading id="varorigins" depth="3" name="varOrigins" sig="varOrigins: VarOriginMap" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L378" sourceLabel="schema.ts:378" />

Origin-tagged role defaults + role vars (lowest two tiers), populated by the loader for the `vars trace` command. Purely additive: the executor ignores it.

<MemberHeading id="vars" depth="3" name="vars" sig="vars: Record<string, unknown>" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L359" sourceLabel="schema.ts:359" />
