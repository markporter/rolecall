# 0014 — Project & Plugin Architecture (folder-projects, JIT bundle-or-node_modules, FQCN-from-path)

- Status: **Accepted**
- Date: 2026-10-12
- Supersedes: refines the runtime-PM and npm-tier assumptions of ADR 0011 (those become build-time/emitted, not runtime-resolved)
- Related: [ADR 0007](superseded/0007-project-layout-and-npm-distribution.md) (project layout), [ADR 0011](superseded/0011-module-and-plugin-namespacing.md) (namespacing), [ADR 0005](0005-io-abstractions-vfs-db-scratch.md) (VFS/DbConn/ScratchVfs seams), [ADR 0009](0009-ansible-compatibility-and-mechanical-conversion.md) (Ansible compatibility), [ADR 0015](0015-collections-and-install-commands.md) (dependency distribution)

## Context

RoleCall dispatches tasks by a module name resolved through a single flat `Map<string, Module>` keyed by bare name (`src/executor/module.ts`): `registerModule` does `registry.set(mod.name, mod)` (silent overwrite, no guard) and `runner.ts` does a pure `getModule(task.module)` lookup. There is no FQCN, no collision policy, no local plugin/role scanning. Modules arrive from four sources and the model serves none well: builtins (bare short names, no namespace); plugins registered via `plugin register --path` (auto-loaded under the bare name, can silently clobber a builtin); role-local modules (documented by relative path but **no loader scans a role's `modules/` dir** — non-functional today); npm-distributed modules (ADR 0007 documents `rolecall.yaml imports:` but `src` has no handling and no `@` resolution).

The user requirement is **"everything is a project"**: a role is a project, a plugin is a project, and running a playbook *from a directory* must resolve the plugins/roles that live there **at runtime by scanning the directory** — not by installing anything. At the same time the design must stay network-free and read-only-friendly in serverless, container, and read-only-media environments, and must handle plugins whose dependencies include native addons. This ADR records the on-disk shape and the resolution algorithm that meets all of those, and replaces the "runtime package manager" and "npm-tier runtime resolution" ideas from ADR 0011 with a local-file + cached-bundle model.

## Decision

### 1. Folder-project structure (uniform, recursive)

A **project** or **role** is a directory with a uniform shape. Roles are themselves projects (recursive uniformity — a role carries the same structure as a top-level project):

```
<project-or-role>/
  plugins/
    <type>/                         # plugin TYPE, inferred from path (not in the FQCN)
      <namespace>/                  # FQCN namespace (the "collection" unit)
        package.json                # collection manifest + its dependencies
        name1.ts                    # source
        name2.ts
        name1_bundled.js            # pre-built bundle (colocated) — see §4
        name2_bundled.js
    connection_types/<namespace>/…   # reserved type dir
    callbacks/<namespace>/…          # reserved type dir
    inventory/<namespace>/…          # partial type dir
    facts/<namespace>/…              # partial type dir
  roles/                            # sub-projects (roles are projects)
    web-tier/
      plugins/modules/<namespace>/…
      playbooks/site.yaml            # role entry playbook
  playbooks/site.yaml               # project entry playbook
```

### 2. Plugin TYPE is a directory segment

The first level under `plugins/` is the **plugin type** (`modules`, `connection_types`, `callbacks`, `inventory`, `facts`). This mirrors Ansible's plugin-type taxonomy and RoleCall's actual extension seams (`src/modules` = modules; `src/transport` = connection types; the `-o` output plugins = callbacks; `InventoryPlugin` = inventory; `registerFactPlugin` = facts). The type is inferred from the directory, so it is **not** repeated in the FQCN (Ansible convention: `namespace.collection.name`, kind chosen by task context). Only `modules` is fully wired today; `inventory`/`facts` have partial interfaces; `connection_types`/`callbacks` are **reserved** dirs (schema ahead of code). Reserve all type dirs now.

### 3. Collection folder unit: `package.json` + sources + `_bundled.js`

Each `<type>/<namespace>/` folder is the shippable unit ("collection"). It contains:
- **`package.json`** — one per namespace-folder, declaring that collection's name, version, and dependencies (the dep set shared by the `.ts` files in the folder). Granularity = one `package.json` per namespace-folder, not per individual plugin file.
- **`.ts` sources** — `name1.ts`, `name2.ts`, … the plugins.
- **`<name>_bundled.js`** — the pre-built, self-contained bundle for each source (colocated with the source). Present when pre-baked (deployed/read-only); absent when not yet built.

### 4. Resolution algorithm (runtime, network-free)

On resolving a plugin reference, RoleCall scans the project's `plugins/` **and** every `collections/*/*/plugins/` (populated by ADR 0015). For each candidate folder it applies:

1. **Bundle present** (`<name>_bundled.js`) → load it. No work.
2. **No bundle, pure-JS deps** → transient `bun install` into an ephemeral sandbox (tmpfs/temp, discarded after) + `Bun.build` to inline deps into a single file → write `<name>_bundled.js` (colocated **or** to the VFS cache) → load. This is **JIT bundling**: it fires only when no bundle exists *and* a writable VFS target is available; the result is cached, so it is not a per-run build.
3. **No bundle, native deps detected** → `bun install` into a **local `node_modules`** kept next to the folder (not discarded) → load from there. Native addons cannot be inlined into a portable single file, so the node_modules tree is the emitted form.

Runtime **never fetches from npm and never resolves a module graph**; it only reads local files and already-built bundles. The `bun install` in steps 2–3 is a transient, sandbox build step (dev/JIT or pre-hydration), not a runtime dependency acquisition.

### 5. FQCN = `<namespace>.<name>`; builtins are separate

- The fully-qualified name is `<namespace>.<name>`; the type is implied by the directory it was found under. `plugins/modules/myorg/firewall.ts` → module FQCN `myorg.firewall`.
- **Builtins** (`rolecall.builtin.*` / `ansible.builtin.*`) are code-registered from `src/modules/builtins/` and live outside `plugins/`; they are **reserved** for bare short names. User plugins are addressed by FQCN (`myorg.firewall`) or `scope.name`; a bare user name is rejected when it collides with a builtin (matches ADR 0011 §5).

### 6. Bundle cache is content-addressed

A bundle's cache key = hash(`<type>/<namespace>` sources + `package.json` deps + bun version + `os/arch`). Any change invalidates and rebuilds. For native node_modules the same key governs reuse. This makes the VFS artifact store and the JIT bundle cache the same place (ADR 0005).

### 7. Native-dep policy

A plugin whose dependency tree includes a native addon is emitted as a kept `node_modules` tree rather than a single file (§4.3). Such a tree is platform-locked (`os/arch`) and must be tagged accordingly; it is shipped read-only or baked. Pure-JS plugins remain portable and bundle anywhere.

### 8. Trust boundary

JIT `bun install` executes package lifecycle scripts. Local project plugins (run from *your* directory) are trusted. A distributed/untrusted plugin must arrive **pre-bundled** (`_bundled.js`) so resolution never triggers an install. Keep that as the security boundary.

### 9. Bundling tooling

Bundling uses the embedded/vendored bun (`Bun.build`) so RoleCall adds no new dependencies; under a Node runtime, esbuild is the fallback. This honors "batteries included / minimal extra deps."

## Consequences

**Positive**
- One uniform on-disk model covers project-local plugins, role-local plugins, and distributed (collected) plugins; "everything is a project" is literal.
- Runtime is network-free and node_modules-free for the common (pure-JS) case; it only reads local files and cached bundles.
- Read-only and minimal-footprint environments work: load is a read; ephemeral needs (import temp, JIT cache) go to tmpfs; the standalone binary reads single files from the VFS and never needs a module graph.
- Native deps are a localized emit, not a second runtime architecture.
- Builtins are protected from silent clobber; provenance is visible in the name (`rolecall.builtin.copy` vs `myorg.firewall`).
- Ansible-compatible shape aids ADR 0009 migration.

**Negative / risk**
- JIT is a cached build step (transient install + bundle); it must be scoped to "no bundle present + writable VFS target" so it is never mistaken for the rejected "runtime always builds."
- Bundling still needs a transient install to inline deps; the native path keeps node_modules.
- Per-folder `package.json`/`node_modules` duplicates dependencies across collections; acceptable for isolation, a shared cache is a later optimization.
- `connection_types`/`callbacks` type dirs are reserved but not yet user-extensible; the SDK for those types is future work.

**Work items (implementation, not in this ADR)**
1. Project/role scanner: discover `plugins/<type>/<namespace>/` in the project and in every `collections/*/*/`.
2. `resolveModule` / FQCN resolver + directory scan, replacing the bare `getModule` lookup; builtin reservation + collision guard.
3. JIT bundle path: transient install + `Bun.build` + colocated/VFS cache write.
4. Native node_modules path: detect native deps, install-and-keep.
5. Type SDKs for `connection_types` and `callbacks` (today built-in only).
6. Config for bundle location (colocated vs VFS) and for the JIT-cache VFS backend.

**Resolved open questions**
- Bundle location: colocated `_bundled.js` is the **primary** form (the local VFS backend — the whole project is already "in VFS", and local is just the default backend). The VFS cache (S3/DB) is the **dev-JIT alternative** (used when no bundle is present and a writable VFS target is available; see §4.2).
- Bare-name policy: plugin FQCNs are unique **by construction** (folder namespacing derives a distinct `<namespace>.<name>` per file), so **collisions only surface when a playbook references a bare name** — never at plugin-definition time. Builtins keep their **reserved bare names** (bare `copy` always resolves to `rolecall.builtin.copy`). A user plugin is reachable by FQCN (`myorg.firewall`) or by its bare name **when unambiguous**; an **ambiguous bare reference** in a playbook is a **hard error**, resolved by writing the explicit FQCN. **Best practice: FQCN for all user plugins** to avoid ambiguity entirely.
- Per-folder dependency de-duplication: **isolation over sharing** — no de-duplication across folders; reliability > disk space (see Negative/risk).

## References
- RoleCall source: `src/executor/module.ts`, `src/executor/runner.ts`, `src/modules/loader.ts`, `src/cli/commands/plugin.ts`, `src/store/plugin-store.ts`, `src/config/loader.ts`, `src/transport/`, `src/inventory/plugin.ts`, `src/facts/engine.ts`.
- ADR 0005 (VFS/DbConn/ScratchVfs seams), ADR 0007 (project layout), ADR 0009 (Ansible compatibility), ADR 0011 (module/plugin namespacing), ADR 0015 (collections & install commands).
