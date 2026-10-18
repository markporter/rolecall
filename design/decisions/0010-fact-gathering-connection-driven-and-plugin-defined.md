# 0010 — Fact gathering is connection-driven and plugin/module-defined

- Status: **Accepted**
- Date: 2026-10-06

> **Operator note:** Facts are referenced in templates via the `facts.` namespace using the single `$var` operator (e.g. `{$var: "facts.hostname"}`). The prior `$fact` operator was retired by ADR 0013 (alpha — no backward-compatibility obligation) and must not be used.

## Context
RoleCall gathers facts through a `FactsEngine` with `FactGatherer`s, but the mechanism had
two weaknesses relative to how operators (and Ansible) expect facts to work:

1. **No connection-type selection.** Gatherers were not keyed to `Connection.kind`;
   only `serviceGatherer` carried an inline `conn.kind === "http"` branch, and
   `network`/`http` hosts could receive shell-based gatherers that do not apply.
   Ansible instead lets the connection/transport type choose the *mechanism*
   (`setup` on shelled targets; platform `<platform>_facts` modules on network
   transports).

2. **Disconnected fact registries.** The declared-fact set (`var-manifest.yml`
   `kind: fact` entries, consumed by `lintTemplateRefs` for `var_strict`) and the
   runtime producer set (gatherers) were unrelated: you could declare a fact nothing
   produced, or produce a fact nothing declared. There was no first-class way for a
   **plugin or module** to own facts.

The user wants facts defined by plugins/modules in the future, with connection type
driving what is gathered.

## Decision
1. **Connection-kind-aware gatherers.** Add `connectionKinds?: ConnectionKind[]` to
   `FactGatherer`. The engine filters candidate gatherers by `conn.kind` at gather
   time. Gatherers without the field apply to all kinds (backward compatible). Split
   the monolithic `serviceGatherer` into `serviceGathererPosix` (`ssh`/`local`,
   `systemctl is-active ssh`) and `serviceGathererHttp` (`http`, `conn.health()`).
   `osGatherer`/`networkGatherer` are scoped to `ssh`/`local`.

2. **Plugin-defined facts as a first-class extension.** Add a global fact-plugin
   registry with `registerFactPlugin({ name, gatherers, declares })`. `FactPlugin`
   gains `declares?: VarManifestEntry[]` — the typed fact schemas the plugin owns.
   Registered gatherers feed the engine; registered `declares` feed a global
   declared-fact set.

3. **Module-owned facts.** Extend the `Module` contract with optional `facts?:
   VarManifestEntry[]` and `factGatherer?: FactGatherer`. `registerModule` auto-wires
   any module that declares facts into `registerFactPlugin`, so module-authored facts
   need no extra plumbing.

4. **Bridge declarations → `var_strict`.** `lintTemplateRefs` merges the global
   declared-fact set (manifests **plus** registered plugins/modules) into
   `    declaredFacts`. A `facts.` reference is valid if declared in either place. A
   declared fact is, by construction, one a registered gatherer can produce.

5. **Schema reuse.** Plugin/module fact declarations reuse `VarManifestEntry` from the
   var-manifest module, giving every fact a typed, documented contract.

## Consequences
- Facts gathering is now **connection-type selected** (Ansible-aligned): `ssh`/`local`
  run shell gatherers, `http` probes health, `network` runs only
  `connectionKinds:["network"]` gatherers (none built-in yet).
- **Plugins and modules can own facts** with a typed schema, and those facts are
    automatically valid under `var_strict` `facts.` checks.
- The two fact registries are unified: declaration implies a producer.
- Backward compatible: gatherers without `connectionKinds` still apply everywhere;
  built-in gathering behavior for `ssh`/`local`/`http` is preserved (only the
  `serviceGatherer` split changes internals, not outputs).
- Out of scope (future): targeted gather by declared fact names (`gather_subset`
  analog), fact-value schema validation, network platform fact modules, provenance
  tracing.
