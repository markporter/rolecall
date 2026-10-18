# RoleCall — Facts & Connection-Driven Gathering

This document is the design home for RoleCall's fact system: how facts are **defined**,
how they are **gathered** at runtime, and how **connection type** selects the
appropriate gathering mechanism. It is the "why/where-to" companion to the
implemented code in `src/facts/**`. See `decisions/0010-fact-gathering-connection-driven-and-plugin-defined.md`
for the recorded decision.

> **Honesty note.** Fact gathering is implemented and applied live today (the
> `FactsEngine` runs real gatherers over SSH/local/HTTP connections during
> `playbook run` and `facts gather`). It is **not** scaffolded. The templating
> surface is the structured `$fact` operator (not the full Jinja `{{ }}` renderer).
> Scheduler/webhooks/UI remain scaffolded.

---

## 1. Core concepts

- **Fact** — a named piece of *observed* state about a target (`os`, `hostname`,
  `service_status`, ...). Distinct from a **var** (a *declared* value). The
  `VarManifestEntry.kind` field (`"var" | "fact"`) keeps the two namespaces separate
  so `$var` and `$fact` validate against the right set.
- **Gatherer** (`FactGatherer`) — a unit that produces a *subset* of facts for a
  connection. Declares `provides: FactKey[]` and (now) `connectionKinds?:
  ConnectionKind[]` — the connection types it is valid for.
- **Plugin** (`FactPlugin`) — bundles one or more gatherers plus optional
  `declares: VarManifestEntry[]` (the fact *schemas* the plugin owns). This is the
  extension point for user/plugin-defined facts.
- **Engine** (`FactsEngine`) — resolves the minimal gatherer set for the requested
  keys **and** the current connection kind, runs them, merges into a `FactMap`, and
  caches per host+keys. Graceful partial on gatherer failure.

---

## 2. Connection type selects the mechanism (Ansible alignment)

Ansible decides *how* to gather facts from the connection/transport type:

- **Shelled targets** (ssh/local/winrm) → `gather_facts` → `setup` runs a Python
  module **on the target**, returning `ansible_facts`.
- **Network targets** (`network_cli`/`httpapi`/`netconf`) → no shell/Python, so
  `setup` does **not** apply; platform-specific `<platform>_facts` modules run on the
  control node and feed `ansible_net_*` / `ansible_network_resources`.

So: **connection type → mechanism; OS/platform → content; module/plugin →
definitions.** RoleCall mirrors this with `Connection.kind`:

| `Connection.kind` | Applicable built-in gatherers | Why |
|---|---|---|
| `ssh` | `osGatherer`, `networkGatherer`, `serviceGathererPosix` | real host with a shell |
| `local` | `osGatherer`, `networkGatherer`, `serviceGathererPosix` | same as ssh, local transport |
| `http` | `serviceGathererHttp` | no shell; probe `conn.health()` |
| `network` | *(none built-in)* | no shell; platform modules supply them later |

Each `FactGatherer` declares its `connectionKinds`. The engine filters the candidate
gatherer set by `conn.kind` at gather time, so a host only ever runs gatherers valid
for its transport — exactly the Ansible property. Gatherers without `connectionKinds`
apply to **all** kinds (used by connection-agnostic custom gatherers).

---

## 3. Plugin / module-defined facts (the extension model)

The system supports facts owned by **plugins and modules**, not just the built-in
gatherers:

1. **A plugin registers a fact provider.** `registerFactPlugin({ name, gatherers,
   declares })` adds the gatherers to the engine and records the `declares` schemas in
   a global declared-fact registry.

2. **A module owns facts.** The `Module` contract gains optional `facts?:
   VarManifestEntry[]` (schemas it can produce) and `factGatherer?:
   FactGatherer` (how to gather them). `registerModule(mod)` automatically calls
   `registerFactPlugin` for any module that declares facts — so module-authored facts
   are first-class with no extra wiring.

3. **Declarations bridge into `var_strict`.** The global declared-fact registry is
   merged into `lintTemplateRefs`' `declaredFacts` set. A `$fact` reference is valid
   if it appears in either a `var-manifest.yml` (`kind: fact`) **or** a registered
   plugin/module's `declares`. This closes the earlier gap where the manifest
   `kind: fact` set and the runtime producer set were disconnected: now a declared
   fact is, by construction, one a registered gatherer can produce.

### Schema reuse
`FactPlugin.declares` and `Module.facts` reuse `VarManifestEntry` from
`src/config/var-manifest/types.ts` — the *same* schema used by `var-manifest.yml`.
This means a fact declaration carries `name`, `kind: "fact"`, `source: "observed"`,
`type`, `required`, `nullable`, etc., giving every fact a documented, typed contract
that the web/TUI/LLM surfaces can later render.

---

## 4. Runtime flow

```
playbook run / facts gather
  └─ buildConnectionForHost(host) → conn (conn.kind known)
       └─ FactsEngine.gatherFacts(conn, requestedKeys, opts)
            ├─ #resolveGatherers(requestedKeys)          // by provides keys
            ├─ filter by conn.kind                       // NEW: by connection type
            ├─ run each gatherer over conn (exec/health)
            ├─ merge → FactMap, cache per host+keys
  └─ factsByHost → executor buildVars → { facts } namespace
       └─ $fact resolves from the facts namespace
```

`lintTemplateRefs` (playbook load time) independently validates `$fact` refs against
`declaredFacts = manifest(kind:fact) ∪ registeredPluginDeclares`, gated on a
non-empty registry (so un-manifested plays are not falsely flagged).

---

## 5. Future work (out of scope here)

- **Targeted gather by manifest:** pass a playbook's declared `kind: fact` names as
  `requestedKeys` so only those gatherers run (the Ansible `gather_subset` analog).
  Today the engine gathers all kind-applicable gatherers.
- **Fact value validation:** validate gathered `FactMap` values against the declared
  `type` schema (mirroring var validation), surfacing drift/wrong-shape at gather
  time.
- **Network platform fact modules:** `network` kind currently has no built-in
  gatherers; platform `<platform>_facts` modules would register `connectionKinds:
  ["network"]` gatherers.
- **Provenance / `rolecall vars trace`:** shipped — `rolecall vars trace <name>` surfaces a
  var's declared-by file/line and full override chain (role-default → extra-vars);
  fact-origin provenance follows the same model.

---

## 6. Mapping to Ansible (quick reference)

| Ansible | RoleCall |
|---|---|
| `gather_facts: true` → `setup` | `FactsEngine.gatherFacts` |
| POSIX `setup` on-target | `osGatherer`/`networkGatherer`/`serviceGathererPosix` (`ssh`/`local`) |
| Network `<platform>_facts` modules | future `connectionKinds: ["network"]` gatherers |
| `connection plugin` selects mechanism | `conn.kind` filters gatherers |
| `ansible_facts` / `ansible_net_*` | `facts` namespace, `$fact` operator |
| custom fact module / `fact_path` | `registerFactPlugin` / `Module.facts` |
| `gather_subset` | (future) targeted gather by declared fact names |
