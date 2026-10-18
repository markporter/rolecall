---
title: ProjectsRepository
kind: class
longname: module:store.ProjectsRepository
description: Typed CRUD over the projects table.
---

# ProjectsRepository

<SourceLink href="/source/src/store/projects-ts/#L34" label="projects.ts:34" />

Typed CRUD over the projects table.

---

## Constructors

<MemberHeading
  id="constructor"
  depth="3"
  name="constructor"
  sig="new ProjectsRepository(
	db: SqliteDb,
	writes: WriteQueue,
): ProjectsRepository"
/>

**Parameters**

- `db` (SqliteDb) — Runtime-selected synchronous sqlite connection shared with every repository.
- `writes` ([WriteQueue](/module/store/writequeue)) — Shared single-writer serialization queue owned by StoreImpl.

**Returns**

`ProjectsRepository`

#### Implements

- [`ProjectsRepo`](/module/store/projectsrepo)

---

## Methods

<MemberHeading id="create" depth="3" name="create" sig="create(input: CreateProjectInput): Promise<Project>" />

<MemberMeta badges="async" sourceHref="/source/src/store/projects-ts/#L44" sourceLabel="projects.ts:44" />

_Implementation of&#x20;_[`create`](/module/store/projectsrepo#create)

**Parameters**

- `input` ([CreateProjectInput](/module/store/createprojectinput))

**Returns**

- `Promise<`[`Project`](/module/store/project)`>`

<MemberHeading id="delete" depth="3" name="delete" sig="delete(id: string): Promise<boolean>" />

<MemberMeta badges="async" sourceHref="/source/src/store/projects-ts/#L101" sourceLabel="projects.ts:101" />

_Implementation of&#x20;_[`delete`](/module/store/projectsrepo#delete)

**Parameters**

- `id` (string)

**Returns**

- `Promise<boolean>`

<MemberHeading id="get" depth="3" name="get" sig="get(id: string): Promise<Project | null>" />

<MemberMeta badges="async" sourceHref="/source/src/store/projects-ts/#L68" sourceLabel="projects.ts:68" />

_Implementation of&#x20;_[`get`](/module/store/projectsrepo#get)

**Parameters**

- `id` (string)

**Returns**

- `Promise<`[`Project`](/module/store/project)` | null>`

<MemberHeading id="list" depth="3" name="list" sig="list(): Promise<Project[]>" />

<MemberMeta badges="async" sourceHref="/source/src/store/projects-ts/#L73" sourceLabel="projects.ts:73" />

_Implementation of&#x20;_[`list`](/module/store/projectsrepo#list)

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

<MemberMeta badges="async" sourceHref="/source/src/store/projects-ts/#L78" sourceLabel="projects.ts:78" />

_Implementation of&#x20;_[`update`](/module/store/projectsrepo#update)

**Parameters**

- `id` (string)
- `patch` ([UpdateProjectPatch](/module/store/updateprojectpatch))

**Returns**

- `Promise<`[`Project`](/module/store/project)` | null>`
