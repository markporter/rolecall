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
	gather_facts?: boolean;
	hosts: string[];
	imports?: string[];
	name?: string;
	post_tasks?: NormalizedTask[];
	pre_tasks?: NormalizedTask[];
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
	vars_files?: string[];
}"
/>

<SourceLink href="/source/src/config/schema-ts/#L388" label="schema.ts:388" />

---

## Properties

<MemberHeading id="appliedrolenames" depth="3" name="appliedRoleNames" sig="appliedRoleNames: string[]" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L421" sourceLabel="schema.ts:421" />

Names of roles applied to this play (post-expansion), preserved for the `play.roles` namespace (ADR 0013 §6) after `roles` is cleared.

<MemberHeading id="checkpoint" depth="3" name="checkpoint" sig="checkpoint: string" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L413" sourceLabel="schema.ts:413" />

Checkpoint id this play applies under (Todo 26).

<MemberHeading id="gatherfacts" depth="3" name="gather_facts" sig="gather_facts: boolean" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L399" sourceLabel="schema.ts:399" />

Ansible compatibility flag preserved for round-trip; RoleCall gathers facts lazily regardless.

<MemberHeading id="hosts" depth="3" name="hosts" sig="hosts: string[]" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L390" sourceLabel="schema.ts:390" />

<MemberHeading id="imports" depth="3" name="imports" sig="imports: string[]" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L401" sourceLabel="schema.ts:401" />

Optional `imports` directives (load-time expansion); absent after expansion.

<MemberHeading id="name" depth="3" name="name" sig="name: string" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L389" sourceLabel="schema.ts:389" />

<MemberHeading id="posttasks" depth="3" name="post_tasks" sig="post_tasks: NormalizedTask[]" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L395" sourceLabel="schema.ts:395" />

Tasks that run after all normal tasks, before the end-of-play handler flush (Ansible `post_tasks`).

<MemberHeading id="pretasks" depth="3" name="pre_tasks" sig="pre_tasks: NormalizedTask[]" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L393" sourceLabel="schema.ts:393" />

Tasks that run before role-composed + play tasks (Ansible `pre_tasks`).

<MemberHeading id="roledefaults" depth="3" name="roleDefaults" sig="roleDefaults: Record<string, unknown>" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L419" sourceLabel="schema.ts:419" />

Role defaults (lowest precedence tier), kept separate from `vars` so the executor can layer it below inventory host/group vars.

<MemberHeading id="roles" depth="3" name="roles" sig="roles: string[]" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L403" sourceLabel="schema.ts:403" />

Roles composed into this play at load time; empty once expanded away.

<MemberHeading id="serial" depth="3" name="serial" sig="serial: number" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L408" sourceLabel="schema.ts:408" />

<MemberHeading id="strategy" depth="3" name="strategy" sig="strategy: 'linear' | 'free'" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L409" sourceLabel="schema.ts:409" />

<MemberHeading id="tags" depth="3" name="tags" sig="tags: string[]" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L406" sourceLabel="schema.ts:406" />

Play-wide tags inherited by every task lacking its own `tags:`; selected at run time by the global `--tags` / `--skip-tags` flags.

<MemberHeading id="tasks" depth="3" name="tasks" sig="tasks: NormalizedTask[]" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L391" sourceLabel="schema.ts:391" />

<MemberHeading id="trigger" depth="3" name="trigger" sig="trigger: { spec: string; type: 'cron' } | { path?: string; type: 'webhook' }" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L407" sourceLabel="schema.ts:407" />

<MemberHeading id="tx" depth="3" name="tx" sig="tx: string" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L411" sourceLabel="schema.ts:411" />

Transaction id grouping dependent plays for rollback (Todo 26).

<MemberHeading id="varstrict" depth="3" name="var_strict" sig="var_strict: boolean" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L417" sourceLabel="schema.ts:417" />

When true (the default), `$var` references must use a known namespace (`vars.`/`facts.` by default) and resolve to a declared manifest entry (var_strict). Set false to permit undeclared references.

<MemberHeading id="varmanifests" depth="3" name="varManifests" sig="varManifests: VarManifestEntry[]" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L415" sourceLabel="schema.ts:415" />

Declared variable manifests collected for this play (role defaults manifests + playbook-root manifest), used by later phases for strict var validation and resolution. Absent until the loader discovers manifests.

<MemberHeading id="varorigins" depth="3" name="varOrigins" sig="varOrigins: VarOriginMap" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L423" sourceLabel="schema.ts:423" />

Origin-tagged role defaults + role vars (lowest two tiers), populated by the loader for the `vars trace` command. Purely additive: the executor ignores it.

<MemberHeading id="vars" depth="3" name="vars" sig="vars: Record<string, unknown>" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L404" sourceLabel="schema.ts:404" />

<MemberHeading id="varsfiles" depth="3" name="vars_files" sig="vars_files: string[]" />

<MemberMeta sourceHref="/source/src/config/schema-ts/#L397" sourceLabel="schema.ts:397" />

Ordered play-relative vars files merged below explicit play `vars:`.
