# 0011 — Module and plugin namespacing

- Status: **Retired — superseded by ADR 0014 (architecture & namespacing)**
- Date: 2026-10-09
- Related: ADR 0007 (project layout and npm distribution); ADR 0009 (Ansible compatibility and mechanical conversion); ADR 0008 (literal-by-default templating); `docs/content/guide/project-structure.md`

> **Retired.** This ADR is superseded by [ADR 0014](../0014-project-and-plugin-architecture.md) (project & plugin architecture, including FQCN + builtin-namespacing). The current namespacing rule lives in ADR 0014. Do not use this for new work.

## Context

RoleCall dispatches tasks by a module name stored as `task.module` and resolved through
a **single flat `Map<string, Module>`** keyed by `name` (`src/executor/module.ts`):
`registerModule` does `registry.set(mod.name, mod)` (silent overwrite, no guard) and
`src/executor/runner.ts:197` does a pure `getModule(task.module ?? "")` lookup. There
is no FQCN, no collision policy, and no precedence resolver.

Modules arrive from four sources today, and the model does not serve any of them well:

1. **Builtins** — `registerAllModules()` (`src/modules/builtins/index.ts`) registers
   ~19 modules under bare short names (`copy`, `file`, `git`, …). No namespace.
2. **Plugins** — `plugin register <name> --path <file>` persists `{type,name,path}` to
   `.rolecall/plugins.json` (`src/store/plugin-store.ts`) and `loadRegisteredPlugins`
   (`src/cli/commands/plugin.ts`) auto-loads them under the module's bare `name`.
   A plugin named `copy` would **silently overwrite** the builtin with no warning.
3. **Role-local modules** — examples reference them by relative path
   (`./modules/enable-site`, `examples/nginx-baseline/roles/web-tier/playbooks/site.yaml:5`),
   but **no loader code scans a role's `modules/` dir and registers it** (grep of
   `src/config/loader.ts` / `src/modules/loader.ts` finds only `roleDir` assignment at
   `loader.ts:482` and task-import resolution at `loader.ts:706` — nothing that turns
   `roles/<r>/modules/*.ts` into a registry entry). `resource()` modules without an
   explicit `name` (e.g. `enable-site.ts`) have no resolvable key. So the documented
   `./modules/...` form is currently **non-functional**, not merely ambiguous.
4. **npm-distributed modules** — `docs/content/guide/project-structure.md` documents
   `rolecall.yaml` `imports:` of `@myorg/rolecall-nginx` and task keys like
   `@myorg/rolecall-nginx/install`, but `src` contains **no handling** of a `rolecall.yaml`
   `imports:` manifest field (in RoleCall today `imports` means *play-level* task-file
   splicing — `src/config/loader.ts:282` / `schema.ts:166` — unrelated to npm). No
   scoped/`@` package resolution exists anywhere in `src`. Entirely scaffolded.

### How Ansible handles it (grounding)

Ansible is the reference model RoleCall borrows from (ADR 0009). Its namespacing, per the
official Ansible documentation retrieved via Context7
(`/ansible/ansible-documentation`, `collections_guide/collections_using_playbooks.rst`,
`tips_tricks/ansible_tips_tricks.rst`, `dev_guide/migrating_roles.rst`):

- **FQCN** is `namespace.collection.plugin` — e.g. `my_namespace.my_collection.my_module`
  for modules, and the same shape for lookups/filters/callbacks. Plugin types share one
  scheme.
- **Builtins** live in the reserved `ansible.builtin` collection; `ansible.builtin.copy`
  is the canonical form and the short `copy` is an alias that resolves to it.
- The **`collections:` keyword** sets an *ordered* search path for **unqualified**
  module/action names within a play/role. Non-module plugins (lookups, filters) always
  require FQCN even inside a `collections:` scope. Roles do **not** inherit a play's
  `collections:` — a key reason Ansible recommends always using FQCN.
- **Roles ship private modules** under `roles/<role>/library/`. When a short name
  collides with a collection module, the role-local one is reached via the
  `ansible.legacy.<name>` FQCN.
- **Distribution = collections.** A collection is a versioned package (Galaxy/pip) and
  its `namespace.collection` *is* its namespace on disk
  (`ansible_collections/<namespace>/<collection>/`), so packaging and namespacing are
  the same fact.

## Decision

Adopt a **canonical FQCN for distributed/registered modules** and **keep relative-path
task keys for local/role modules**, with a single resolver that normalizes every
user-facing task key to a registry entry. Resolve the four open questions from the
prior design discussion as follows (recommended options).

### 1. Canonical identifier shape

- Distributed/registered modules use a **dotted FQCN**: `namespace.collection.module`.
  Local/role modules use their **relative path string** (`./modules/foo`) as the
  registry key — already unique and already documented, so no new namespace is invented
  for them.

### 2. Namespace table

| Source | Canonical key | Collapsed task-key form |
| --- | --- | --- |
| Builtins | `rolecall.builtin.copy` (alias `ansible.builtin.copy`) | `copy` |
| Project-local | `<rel-path>` e.g. `./modules/foo` | `./modules/foo` |
| Role-local | `<rel-path>` e.g. `./modules/enable-site` (relative to `roleDir`) | `./modules/enable-site` |
| npm package | `scope.pkg.install` ← `@scope/rolecall-nginx` + `/install` | `@myorg/rolecall-nginx/install` |
| User plugin | `plugin.<name>` (+ bare `<name>` alias) | `plugin.my_mod` or `my_mod` |

### 3. Resolver (`resolveModule(key)` replaces the bare `getModule` call)

- key contains `/` → scoped/npm path: `@scope/pkg/sub/...` → `scope.pkg.sub....`
  (non-scoped `pkg/sub` → `pkg.sub`); exact FQCN lookup.
- key contains `.` and is not a relative path → exact FQCN lookup.
- key starts with `./` or `../` → exact path-key lookup (local/role module).
- otherwise (bare short name) → run the precedence chain in §4.

### 4. Resolution precedence for a bare short name

1. `rolecall.builtin.<name>` (or `ansible.builtin.<name>`). **Builtins are reserved and win**
   for bare short names — stable and predictable.
2. `plugin.<name>` — a user-registered plugin is reachable by its bare alias only when
   it does not collide with a builtin (see §5).

### 5. Collision policy

- Registering into an already-occupied **FQCN** overwrites with a warning (last writer
  wins) — matches Ansible's collection-shadowing behaviour.
- A plugin whose bare alias equals a builtin name is **rejected** by `plugin register`
  (reserved namespace), unless an explicit `--force`/override flag is passed. The FQCN
  `plugin.<name>` is always allowed, so a user who truly wants `copy` semantics uses a
  distinct name or calls `plugin.copy` explicitly.

### 6. Builtin reservation

`rolecall.builtin.*` is the reserved builtin collection; `ansible.builtin.*` is an accepted
alias for Ansible muscle-memory compatibility (ADR 0009). Builtins are registered under
both the FQCN and the bare short alias.

### 7. npm mapping (wire the scaffold)

`rolecall.yaml` `imports:` entries (`@scope/rolecall-nginx`, `rolecall-apt`) are resolved to packages;
their shipped modules/roles become FQCNs `scope.rolecall-nginx.install` / `rolecall-apt.<name>`,
reachable by the documented slash task key `@myorg/rolecall-nginx/install`. This makes the
already-documented `project-structure.md` behaviour real.

### 8. What does NOT change

Local/role modules keep their relative-path task keys — no rewrite of working examples,
and path keys are inherently collision-free. The change is the **resolver + registry
keying + collision guard**, not a new string format for local modules.

## Consequences

**Positive**
- No silent clobber of builtins by a poorly-named plugin.
- Provenance is visible in the name (`rolecall.builtin.copy` vs `plugin.foo` vs
  `scope.pkg.install`).
- npm-distributed modules become real and fit the same FQCN model Ansible uses,
  easing migration (ADR 0009).
- Bare short names keep working for the common case (builtins), so existing docs/examples
  stay valid.

**Negative / risk**
- New resolver code plus a registry that keys on FQCN instead of bare name.
- `plugin register` gains a validation path (reject builtin-shadowing).
- Role-local modules must actually be registered by path (today they are not) — this ADR
  implies finishing that wiring, not just naming.

**Work items (implementation, not in this ADR)**
1. Add `resolveModule(key)` and route `runner.ts:197` through it.
2. Register builtins under `rolecall.builtin.<name>` + `ansible.builtin.<name>` + bare alias.
3. Scan/register role `modules/` dirs under their relative path key at playbook load.
4. Implement `rolecall.yaml` `imports:` → npm package → FQCN registration.
5. Add the collision guard to `plugin register` / `registerModule`.

## Open questions

- Whether to also expose a dotted alias for local/role modules (`project.foo`,
  `role.web-tier.enable-site`) in addition to path keys. **Recommended: no** — path keys
  are sufficient and already documented; adding dotted aliases is churn without payoff.
- Whether `collections:`-style per-play default-namespace scoping is wanted. **Recommended:
  defer** — FQCN-everywhere is simpler and Ansible itself recommends it.

## References

- Ansible FQCN / collections docs (Context7 `/ansible/ansible-documentation`):
  - `collections_guide/collections_using_playbooks.rst` — FQCN usage, `collections:` keyword, search path.
  - `tips_tricks/ansible_tips_tricks.rst` — "always use FQCN"; `ansible.builtin` prefix.
  - `dev_guide/migrating_roles.rst` — `ansible.legacy.<name>` for role-local modules.
- RoleCall source: `src/executor/module.ts`, `src/executor/runner.ts:197`,
  `src/modules/builtins/index.ts`, `src/store/plugin-store.ts`,
  `src/cli/commands/plugin.ts`, `src/config/loader.ts`, `src/modules/loader.ts`,
  `docs/content/guide/project-structure.md`.
