# 0007: Project Layout & npm-Distributed Modules/Roles

- Status: **Retired — superseded by ADR 0015 (distribution) and ADR 0014 (architecture/namespacing)**
- Date: 2026-09-19
- Supersedes: none
- Related: [ADR 0004](0004-serverless-and-git-friendly.md) (git-backed projects & serverless target capabilities), [ADR 0005](0005-io-abstractions-vfs-db-scratch.md) (the VFS/DbConn seams), [ADR 0006](0006-storage-backend-colocation-and-postgres.md) (storage backend colocation + Postgres auto-fallback), [`vfs-and-io-abstractions.md`](../vfs-and-io-abstractions.md)

> **Retired.** This ADR is superseded by [ADR 0015](../0015-collections-and-install-commands.md) (collections & distribution) and [ADR 0014](../0014-project-and-plugin-architecture.md) (project & plugin architecture), which hold the current, corrected decisions. Do not use this for new work — read ADR 0014/0015 instead.

## Context

A RoleCall-managed project needs a predictable on-disk layout that an operator can copy, version, and share. It also needs a way to reuse work: small reusable units (modules) and larger composable units (roles). Ansible solved this with `library/` + `roles/` + Galaxy; RoleCall is a JS/TS-first tool, so the natural distribution channel is **npm**, which already provides namespacing (scopes), versioning (semver), content caching (`node_modules`), and discovery (`npm search`).

The T2 `ProjectSource` seam already resolves `module: ./path` from a project, and the idempotency helper lib (`resource({ describe, converge })` from Todo 27) already defines the module authoring shape. This ADR records *which* layout and *which* distribution model RoleCall commits to, so the `--create-project` wizard and the import resolver can be built against a fixed target.

## Decision

### Modules: TypeScript, distributed as npm packages

A module is a low-level, TS-authored unit built on `resource({ describe, converge })`. There is no declarative (no-code) module spec — modules are functions.

Modules are shared two ways:

1. **npm packages** (primary shareable form), e.g. `@myorg/rolecall-nginx` exporting one or more modules.
2. A project-local **`modules/`** folder for private modules, referenced as `module: ./path`.

A local module can later be promoted to an npm package with the same `resource()` shape.

### Roles: full RoleCall projects

A role is a complete RoleCall project in its own right: its own `rolecall.yaml`, `playbooks/`, `modules/`, `roles/`, `inventory/`, `group_vars/`, `host_vars/`. It is distributed via npm (a role *is* an npm package that happens to be a project). Local, project-private roles live in a project `roles/` directory and are not published. A role ships defaults (`group_vars/`, `host_vars/`) and an `entry` playbook, and is host-agnostic (it does not ship a real inventory).

### Recursive import resolution

A project's `rolecall.yaml.imports[]` lists npm coordinates. RoleCall walks each imported package's `rolecall.yaml`, recurses into *its* imports, and builds a dependency DAG with cycle detection. npm performs the actual nested `node_modules` layout + version dedup; RoleCall only reads the resolved tree.

### Namespace addressing

- Package-qualified specifiers (`@scope/name/...` or unscoped `name`) resolve from `node_modules` or a content-addressed cache.
- A bare name resolves **local `roles/` first, then npm-installed**. A local `roles/` entry shadows an unscoped npm package of the same name (Ansible convention). Scoped names are always npm.
- `module: "@org/rolecall-nginx/install"` resolves to `node_modules/@org/rolecall-nginx/modules/install.ts`.
- `roles: ["@org/rolecall-nginx"]` composes that package's `entry` playbook into the parent DAG.

### `--create-project` wizard

A new CLI subcommand (the vfs plan's "no new CLI" guard was scoped only to that plan) scaffolds a project: prompts for name/description, inventory style, seeds a sample local TS module and an optional local role, and writes `imports:` from prompted npm deps. It writes files only and runs nothing (the executor is scaffold).

### Single-file binary nuance

Local `modules/` and `roles/` are ordinary files on disk, read via `FsProjectSource`, and work in every form. npm modules/roles need `node_modules`, which the bundled `bun build --compile` binary lacks; they rely on the deferred content-addressed cache (the VFS seam). So local roles/modules are fully supported everywhere; npm ones are first-class under `bun`/`node` and land in the standalone binary once the cache backend ships.

## Consequences

- **Positive:** one distribution story (npm) covers modules and roles; a role being a project collapses "module distribution" and "role distribution" into a single recursive resolver. Local `roles/` gives the zero-infra, in-repo reuse Ansible users expect.
- **Honesty cost:** each module/role behavior is marked Proposed/deferred until its own tests prove it executes — keep in mind `playbook run` already drives real application over SSH/local transports via the executor and transport layer, so any claim must reflect actual convergence rather than design intent. This ADR designs resolution/composition, not live execution.
- **Constraint cost:** `resolveImportablePath` gains a package-qualified branch; the import resolver and playbook composition are new modules. The wizard adds one interactive-prompt dependency. Keep `dbBackend` and `imports` values narrow and env/declarative-only.
- **Risk:** bare-name local-over-npm precedence can surprise if a local `roles/<x>` accidentally shadows a wanted npm package `<x>`; mitigate by using scopes and by documenting the precedence in `docs/content/guide/project-structure.md`.
