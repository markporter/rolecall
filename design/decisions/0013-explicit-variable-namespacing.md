# 0013 — Explicit, scoped variable namespacing with a single `$var` operator

- Status: **Accepted** (implemented — see Work items)
- Date: 2026-10-11
- Related: ADR 0008 (literal-by-default templating + `$template` operator); ADR 0009 (Ansible compatibility, `ansible_compat` / magic-var analogs); ADR 0010 (connection-driven fact gathering + plugin/module-owned facts); ADR 0014 (project & plugin architecture; carries forward FQCN namespacing from retired ADR 0011); structured-ref system in `src/templating/refs.ts`; `var_strict` lint in `src/config/loader.ts`; `buildVars` in `src/executor/runner.ts`; inventory resolution in `src/inventory/engine.ts`
- Revision note: refined from an earlier draft that proposed dedicated `$fact`/`$reg` operators with auto-prefixing. Since RoleCall is in **alpha** (no backward-compatibility obligation, per `AGENTS.md`), the decision is a **single `$var` operator with fully-qualified `namespace.key` paths and no auto-prefix**, plus scoped namespaces `vars`/`facts`/`reg`/`loop`/`play`/`inv`/`role`/`run`/`rolecall`. The earlier auto-prefix/`$fact`/`$reg` approach is superseded. The bare `host` key is replaced by `play.host`; source-attributed role layers (`role.<R>.*`) were intentionally excluded.

## Context

RoleCall exposes several distinct sources of per-host / per-play / per-iteration / per-role data at task render time, but they are not uniformly namespaced today:

1. **Vars** — the precedence-merged host variable map (`role-default → inventory → play → --extra-vars`, `src/executor/engine.ts:49-67`), surfaced as the `vars` key of `TemplateVars` (`src/executor/context.ts:41-48`), built in `buildVars` (`src/executor/runner.ts:56-71`).
2. **Facts** — gathered per host (`src/facts/engine.ts`), surfaced as the `facts` key. Today reached via a *separate* `$fact` operator (`src/templating/refs.ts:185-189`) that auto-prefixes `facts.`.
3. **Registered** — task `register:` results, stored in `state.registered[host][name]` (`runner.ts:261-277`, type `src/executor/context.ts:244`). In `buildVars` these are spread as **top-level scope keys** via `...reg` (`runner.ts:69`) — **not** under any named namespace.
4. **Loop context** — `item` / `index`, spread as **top-level** keys (`runner.ts:56-71`), exempt from the `var_strict` lint (`src/config/loader.ts:173-175`).
5. **Target host** — `host`, a bare top-level key (the target hostname).
6. **Platform / run metadata** — no first-class namespaces exist for RoleCall platform constants (version, runtime, compatibility flag) or run-scoped metadata (run id, source paths, `--limit`/`--forks`).
7. **Play / role / inventory context** — no first-class namespaces exist for play metadata (name, targeted hosts, current host identity, active role, role directory) or for the *source-attributed* inventory layers (per-host host_vars, per-group group_vars, group membership) that the merged `vars` deliberately flattens.

Two structural problems fall out of this:

- **Registered and loop vars are top-level siblings of the reserved aliases** (`host`, `vars`, `facts`, `item`, `index`). A task that does `register: "facts"` (or `"host"`, `"item"`, `"index"`) silently shadows that alias for the rest of the play — an accidental, hard-to-debug collision. And registered vars are only reachable today through the ERB `$template` escape hatch (`tests/executor.test.ts:222-246` reads a registered value via `{$template: "<%= result.stdout %>"}`) because the lint treats any non-`vars.` `$var` as a hard `unprefixed-var` error (`loader.ts:176,250`).
- **Operator/namespace mismatch.** `$fact` auto-prefixes `facts.`, but `$template` (ADR 0008) already reads the whole scope with qualified `facts.`/`reg.`-style dotted paths. Having two different grammars for the *same* fact is incoherent, and there is no `$reg` operator, nor any way to reach inventory/play/role context except ad-hoc.

Because vars / facts / (soon) reg are **already distinct top-level scope keys**, the operator does not need to *encode* the namespace — the path already does. This ADR collapses the surface to **one operator (`$var`) that resolves a fully-qualified `namespace.key` path**, gives every data source its own reserved namespace (including `play`/`inv`/`role` for context and source-attributed inventory), and makes the namespace mechanism explicitly **open and scoped** so future sources can be added without new operators.

## Decision

### 1. One operator: `$var`, fully qualified, no auto-prefix

`$var` is the **only** variable-reference operator. Its operand is a dotted path whose **first segment must be a known namespace**:

```yaml
- debug:
    args:
      # $var: "<namespace>.<key>"
      v:    { $var: "vars.foo" }          # host var (precedence result)
      f:    { $var: "facts.hostname" }     # gathered fact
      r:    { $var: "reg.result" }         # register: result (per host/play)
      i:    { $var: "loop.index" }         # current loop index
      h:    { $var: "play.host" }          # current target host (was bare `host`)
      p:    { $var: "play.hosts" }         # matched hosts for this play
      g:    { $var: "inv.groups.web.hosts" } # members of group `web`
      dbip: { $var: "inv.hosts.db-01.address" } # another host's host_vars
      rn:   { $var: "role.name" }          # current role name
      rp:   { $var: "role.path" }          # current role directory
      invp: { $var: "run.inventory_path" }  # inventory file (run-scoped)
      ver:  { $var: "rolecall.version" }        # RoleCall platform var
```

- **No auto-prefix.** `{$var: "foo"}` (bare) is a hard error — the namespace must be stated. This removes the ambiguity of "does `$var: host` mean `vars.host` or the target host?" and keeps the grammar identical to `$template` (`<%= facts.hostname %>`), so the two reference mechanisms agree.
- The **`$fact` operator is removed** (alpha, no compatibility obligation). Every former `$fact: key` becomes `{$var: "facts.key"}`.
- `$template` (ERB) is unchanged: it reads the whole `TemplateVars` scope, so `vars.` / `facts.` / `reg.` / `loop.` / `play.` / `inv.` / `role.` / `run.` / `rolecall.` paths work in `<%= … %>` exactly as in `$var`.

### 2. Namespace table (each is a reserved top-level scope key)

| Namespace | Scope / lifetime | Reserved key | Canonical form | `var_strict`? |
| --- | --- | --- | --- | --- |
| Host vars (precedence result) | per-host / per-play | `vars` | `$var: vars.<key>` | **yes** (`vars.<key>`) |
| Gathered facts | per-host | `facts` | `$var: facts.<key>` | **yes** (`facts.<key>`) |
| `register:` results | per-host / per-play | `reg` | `$var: reg.<key>` | no (runtime-produced) |
| Loop context | per-iteration | `loop` | `$var: loop.item`, `$var: loop.index` | no (loop-produced) |
| Play context | per-play (host-specific: `host`, `groups`, `roles`) | `play` | `$var: play.host`, `$var: play.name`, … | no |
| Inventory (source-attributed) | inventory-wide (cross-host) | `inv` | `$var: inv.hosts.<H>`, `$var: inv.groups.<G>`, … | no |
| Role context | per (play×host×role); defined only inside a role | `role` | `$var: role.name`, `$var: role.path` | no |
| Run / invocation | global (this run) | `run` | `$var: run.id`, `$var: run.inventory_path`, … | no (run-produced) |
| Platform / engine | global (process-constant, not playbook/host/loop/role/run) | `rolecall` | `$var: rolecall.<key>` | no (engine-produced) |

### 3. Assembled `TemplateVars` (consolidated `buildVars` shape)

`buildVars` (`src/executor/runner.ts:56-71`) returns exactly these reserved keys (the merged `vars` result plus every namespace); nothing else is spread at the top level:

```ts
return {
  vars: state.resolved.hosts[host] ?? {},        // merged result (role-default→inv→play→extra)
  facts: state.options.facts?.[host] ?? {},
  reg: state.registered[host] ?? {},             // was: ...reg  (top-level spread — removed)
  loop: { item, index },                          // was: item, index (top-level — removed)
  play: { host, name, hosts, groups, roles, path },// play context (host = current target)
  inv: { hosts, groups, defaults },               // inventory source-attributed (see §7)
  role: inRole ? { name, path, ancestors } : {},  // role context, defined only in a role
  run: { id, started_at, epoch, playbook_path, inventory_path, limit, forks }, // run-scoped
  rolecall: { version, runtime, ansible_compat },      // platform-only constants
};
```

This removes the silent-shadowing footgun: a `register: "facts"` (or `"vars"`, `"play"`, …) now lives at `reg.facts` and can never clobber a reserved alias.

### 4. Registered vars move into a `reg` namespace (the core bug fix)

`state.registered[host][name]` (`runner.ts:261-277`) is surfaced under the `reg` key (above), replacing the collision-prone top-level `...reg` spread. Subfields follow the dotted path: `{$var: "reg.result.stdout"}`, `{$var: "reg.result.results"}` (the per-iteration array), `{$var: "reg.result.changed"}`.

### 5. Loop context moves into a `loop` namespace

`item` / `index` become `loop.item` / `loop.index` (folded into the `loop` scope key above). `expandLoop` continues to drive iteration internally, but the per-iteration `item`/`index` exposed to templates is now `loop.item` / `loop.index`. The lint's loop-context exemption (`loader.ts:173-175`) moves from bare `item`/`index` to `loop.item` / `loop.index`.

### 6. `play` namespace — play / execution context

`play` holds play- and execution-context values. Entries are play-wide except those marked *(host-specific)*, which re-evaluate per host during the play:

- `play.host` *(host-specific)* — current target host name (Ansible `inventory_hostname`). **Replaces the former bare `host` key.**
- `play.name` — the play's `name` field (if set).
- `play.hosts` — matched/targeted hosts for this play (Ansible `ansible_play_hosts`).
- `play.groups` *(host-specific)* — groups the current host belongs to (Ansible `group_names`).
- `play.roles` *(host-specific)* — roles applied to the current host (Ansible `ansible_role_names`); kept here rather than under `role.*` because it is host-specific, not current-role-specific.
- `play.path` *(optional)* — source file the play was loaded from (useful for relative includes).

### 7. `inv` namespace — inventory, source-attributed

`inv` restores the **raw inventory layers** that the merged `vars` deliberately flattens, and enables cross-host reads. Built from the inventory engine's resolved host/group maps (`src/inventory/engine.ts`):

- `inv.hosts` — map of **every** host → that host's inventory-resolved vars (host_vars + inherited group_vars + inventory defaults); `inv.hosts.<HOST>` is the entry for one host (Ansible `hostvars[HOST]`).
- `inv.hosts.<HOST>.groups` — groups `<HOST>` belongs to.
- `inv.groups` — map of **every** group → its member host list; `inv.groups.<GROUP>` is the member list (Ansible `groups[GROUP]`).
- `inv.groups.<GROUP>.vars` — the group's declared **group_vars** (the group_vars file content for that group).
- `inv.defaults` *(optional)* — inventory-level defaults.

The value: `vars.foo` may differ from `inv.hosts.<current>.foo` precisely because role-defaults / play / `--extra-vars` overrode the inventory layer; `inv` lets a template (or a `vars trace`-style check) see that gap, and `inv.hosts.<OTHER>` enables cross-host reads without gathering facts on every host.

### 8. `role` namespace — role context (defined only inside a role)

`role` holds the current role's context. It is populated only while a task executes inside a role (from the role's resolved `roleDir` / name, `src/config/loader.ts`); for top-level play tasks `role` is `{}`. Members:

- `role.name` — current role's name (Ansible `role_name` / `ansible_role_name`).
- `role.path` — current role's root directory (`roleDir`; Ansible `role_path` / `ansible_role_path`) — lets role tasks reference files/templates relative to the role without hardcoding paths.
- `role.ancestors` — chain of enclosing roles for nested includes (Ansible `ansible_parent_role_names`).
- `role.depth` *(optional)* — nesting depth.

**Source-attributed role layers are intentionally out of scope** (see Resolved decisions): `role.<ROLENAME>.defaults` / `role.<ROLENAME>.vars` are not added. The `role` namespace stays scoped to current-role context only.

### 9. `run` namespace — run / invocation metadata

`run` holds metadata specific to this CLI invocation / playbook run — **not** platform constants (those are `rolecall`) and **not** host/play/loop/role-specific. Populated once at run start (`src/cli/commands/playbook.ts` / engine entry):

- `run.id` — unique id for this run (for tracing & artifact paths). *(Moved here from the earlier `rolecall.run_id` — `rolecall` is platform-only.)*
- `run.started_at` / `run.epoch` — controller timestamp at run start. *(Moved here from the earlier `rolecall.now` / `rolecall.epoch`.)*
- `run.playbook_path` — the entry playbook file.
- `run.inventory_path` — the `--inventory` file.
- `run.limit` — the `--limit` value (if set).
- `run.forks` — the `--forks` concurrency value (if set).

### 10. `rolecall` namespace = platform / engine vars only

`rolecall` holds values that are **global, process-constant, and not specific to a playbook, host, loop, role, or run** — RoleCall/controller-provided constants:

- `rolecall.version` — RoleCall version string.
- `rolecall.runtime` — runtime identifier (`bun` | `node`).
- `rolecall.ansible_compat` — boolean Ansible-compatibility flag (ADR 0009).

Run-scoped metadata (`run.id`, run start time, source paths, `--limit`/`--forks`) lives in `run`, **not** `rolecall`, per the platform-only definition of `rolecall`.

### 11. Namespaces are an open, scoped, extensible mechanism

The namespace idea is a **reserved-top-level-key + dotted-path** system, not a hardcoded set. The resolver (`$var`) is namespace-agnostic: it resolves `resolvePath(scope, "namespace.key")`. **Adding a namespace = reserving a scope key and registering its name in the known-namespace set used by the lint** — no new operator, no new resolver branch. The lifetime of each namespace (platform → run → inventory-wide → per-play → per-role → per-iteration) is encoded in its name and populated by `buildVars`. Future scoped namespaces (examples, not committed here): `target` (if `play.host` is ever folded further). The set of namespaces is data, not code.

### 12. Lint alignment (`src/config/loader.ts:168-205`)

- Retire `unprefixed-var`. Replace it with a **namespace-required** check: a `$var` operand whose first path segment is not in the known-namespace set (`vars`, `facts`, `reg`, `loop`, `play`, `inv`, `role`, `run`, `rolecall`) is a hard error (`namespace-unknown` / `namespace-required`).
- `var_strict` declaration checks apply only to `vars.` and `facts.` leaves (as today, `loader.ts:182-203`). `reg.` / `loop.` / `play.` / `inv.` / `role.` / `run.` / `rolecall.` are exempt (runtime/loop/context/run/engine-produced, never manifest-declared).
- Remove all `$fact` handling from the lint and from `REFERENCE_OPS` / `resolveNode` in `refs.ts`.

### 13. What does NOT change

- `$template` (ERB) still reads the whole `TemplateVars` scope; all namespaced paths work unchanged once the namespaces exist.
- The static precedence model for `vars` (`engine.ts:49-67`) is untouched. Registered vars, loop vars, play/inv/role/run/rolecall context were never part of that merge and remain outside it.
- `set_fact` / `add_host` / `slurp` / `tempfile` keep returning data in `data.<module>` and relying on `register:`; they do not mutate live vars (`src/modules/builtins/set_fact.ts:6,29`).

## Consequences

**Positive**

- **One operator, one grammar.** `$var: "<namespace>.<key>"` is the sole variable-reference form and matches `$template`'s `<%= namespace.key %>` exactly.
- **Explicit and debuggable.** The namespace is always visible, so "which source did this value come from?" is answerable at a glance and aligns with `vars trace`.
- **Eliminates the reserved-name shadowing footgun.** `register:` / loop context can no longer clobber `host` / `vars` / `facts`.
- **Scoped namespaces encode lifetime** (platform → run → inventory → play → role → iteration) and expose source-attributed inventory (`inv`) and execution/role/run context (`play`/`role`/`run`) that the merged `vars` hides.
- **Extensible by design.** New scopes are configuration, not new operators or resolver code.

**Negative / risk (breaking — acceptable in alpha)**

- **`$fact` is removed.** Every `$fact: key` becomes `{$var: "facts.key"}` across docs, examples, embedded content, and module `meta.examples`.
- **Registered vars move to `reg.`** — `{$template: "<%= name %>"}` by bare name becomes `{$template: "<%= reg.name %>"}` (or `{$var: "reg.name"}`). Affects `tests/executor.test.ts` case `(j)` and module docs (`set_fact.ts:31`, `add_host.ts:6,44`, `slurp.ts:35`, `tempfile.ts:41`).
- **Loop vars move to `loop.`** — `$var: item` / `$var: index` become `$var: loop.item` / `$var: loop.index`.
- **Bare `host` → `play.host`.** Any `{$var: "host"}` becomes `{$var: "play.host"}`.
- **`unprefixed-var` lint is replaced** by a namespace-required check; the validation intent is preserved (and improved) by per-namespace `var_strict`.

**Work items (implementation, not in this ADR)**

1. `runner.ts`: `buildVars` returns `reg`, `loop: {item,index}`, `play`, `inv`, `role`, `run`, and `rolecall` scope keys; remove the `...reg` spread and top-level `item`/`index`/`host`.
2. `engine.ts` / `runner.ts` / `playbook.ts`: populate `play` (host, name, hosts, groups, roles, path) and `role` (name, path, ancestors) from play metadata + role context; populate `inv` from the inventory engine's per-host/per-group resolved maps (`src/inventory/engine.ts`); populate `run` (id, started_at, epoch, playbook_path, inventory_path, limit, forks) and `rolecall` (version, runtime, ansible_compat) once at run start.
3. `refs.ts`: remove `$fact` from `REFERENCE_OPS` and the `resolveNode` branch; `$var` resolves a dotted path against the scope (no auto-prefix, namespace required).
4. `loader.ts`: replace `unprefixed-var` with a known-namespace check (the 9 namespaces above); keep `var_strict` for `vars.`/`facts.`; exempt the rest; drop `$fact` validation.
5. Migrate all `$fact:` usages → `{$var: "facts.key"}` in `docs/`, embedded content, and module `meta.examples`.
6. Migrate `tests/executor.test.ts` case `(j)` and any `$var: item`/`$var: index`/`$var: host` → `loop.`/`play.host`; update module docs referencing bare registered names.
7. Docs: add the namespace/scope table + operator rule to the user guide; update `AGENTS.md` (four-surface sync).

## Resolved decisions / out-of-scope

- **Source-attributed role layers excluded.** `role.<ROLENAME>.defaults` / `role.<ROLENAME>.vars` (a `roles.<R>.*` mirror of `inv.hosts.<HOST>`) are **intentionally not added**. Role defaults/vars are already reachable via `vars` (possibly overridden), and a precedence-layer view is already served statically by `vars trace`; the runtime cross-role value is low and not worth the namespace proliferation. If needed later, it would be a separate plural `roles` namespace, not `role`.
- **`run` namespace adopted** for run-scoped metadata (run id, start time, playbook/inventory paths, `--limit`/`--forks`), which moves `run.id` and run start time out of `rolecall` (keeping `rolecall` strictly platform: `version`, `runtime`, `ansible_compat`).
- **`play.roles` confirmed** for "all roles on the current host" (host-specific, consistent with `play.groups`), rather than `role.names`.

## References

- RoleCall source: `src/templating/refs.ts` (`$var`/`$fact` resolution, `REFERENCE_OPS`), `src/executor/runner.ts` (`buildVars`, `register` storage), `src/executor/engine.ts` (`applyPlayVars` precedence), `src/executor/context.ts` (`TemplateVars`, `PlaybookResult.registered`), `src/config/loader.ts` (`lintTemplateRefs`, `unprefixed-var`, role `roleDir` / defaults / vars), `src/inventory/engine.ts` (host/group var resolution), `src/facts/engine.ts` (gatherFacts), `src/cli/commands/playbook.ts` (run-scoped metadata / inventory & playbook paths), `tests/executor.test.ts` (register test `(j)`), `src/modules/builtins/set_fact.ts` / `add_host.ts` / `slurp.ts` / `tempfile.ts`.
- ADR 0008 (literal-by-default templating + `$template`), ADR 0009 (Ansible compatibility, `ansible_compat` flag + magic-var analogs), ADR 0010 (fact gathering + plugin/module facts), ADR 0014 (project & plugin architecture; carries forward FQCN namespacing from retired ADR 0011).
