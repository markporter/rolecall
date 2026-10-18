---
title: ProjectsRepo
kind: interface
longname: module:store.ProjectsRepo
description: Typed CRUD over the projects table.
---

# ProjectsRepo

<Signature
  code="interface ProjectsRepo {
	create(input: CreateProjectInput): Promise<Project>;
	delete(id: string): Promise<boolean>;
	get(id: string): Promise<Project | null>;
	list(): Promise<Project[]>;
	update(id: string, patch: UpdateProjectPatch): Promise<Project | null>;
}"
/>

<SourceLink href="/source/src/store/types-ts/#L215" label="types.ts:215" />

Typed CRUD over the projects table.

#### Implemented By

- [`ProjectsRepository`](/module/store/projectsrepository)

---

## Methods

<MemberHeading id="create" depth="3" name="create" sig="create(input: CreateProjectInput): Promise<Project>" />

<MemberMeta badges="async" sourceHref="/source/src/store/types-ts/#L216" sourceLabel="types.ts:216" />

**Parameters**

- `input` ([CreateProjectInput](/module/store/createprojectinput))

**Returns**

- `Promise<`[`Project`](/module/store/project)`>`

<MemberHeading id="delete" depth="3" name="delete" sig="delete(id: string): Promise<boolean>" />

<MemberMeta badges="async" sourceHref="/source/src/store/types-ts/#L220" sourceLabel="types.ts:220" />

**Parameters**

- `id` (string)

**Returns**

- `Promise<boolean>`

<MemberHeading id="get" depth="3" name="get" sig="get(id: string): Promise<Project | null>" />

<MemberMeta badges="async" sourceHref="/source/src/store/types-ts/#L217" sourceLabel="types.ts:217" />

**Parameters**

- `id` (string)

**Returns**

- `Promise<`[`Project`](/module/store/project)` | null>`

<MemberHeading id="list" depth="3" name="list" sig="list(): Promise<Project[]>" />

<MemberMeta badges="async" sourceHref="/source/src/store/types-ts/#L218" sourceLabel="types.ts:218" />

**Returns**

- `Promise<`[`Project`](/module/store/project)`[]>`

<MemberHeading
  id="update"
  depth="3"
  name="update"
  sig="update(
	id: string,
	patch: UpdateProjectPatch,
): Promise<Project | null>"
/>

<MemberMeta badges="async" sourceHref="/source/src/store/types-ts/#L219" sourceLabel="types.ts:219" />

**Parameters**

- `id` (string)
- `patch` ([UpdateProjectPatch](/module/store/updateprojectpatch))

**Returns**

- `Promise<`[`Project`](/module/store/project)` | null>`
