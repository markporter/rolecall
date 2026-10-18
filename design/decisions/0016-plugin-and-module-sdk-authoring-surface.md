# 0016 — Plugin & Module SDK authoring surface

- Status: **Proposed**
- Date: 2026-10-13
- Related: [ADR 0014](0014-project-and-plugin-architecture.md) (project & plugin architecture), [ADR 0015](0015-collections-and-install-commands.md) (collections & distribution), [ADR 0010](0010-fact-gathering-connection-driven-and-plugin-defined.md) (connection-driven fact gathering), [ADR 0013](0013-explicit-variable-namespacing.md) (removed `$fact` operator), [ADR 0003](0003-zod-driven-agent-surface.md) (Zod-driven agent surface)

## Context

RoleCall ships a working module system and a plugin registration mechanism, but the
"richer Plugin SDK authoring surface" is explicitly scaffolded (see the project
README and AGENTS.md). Today an author can write a `Module`, lift it through the
`resource()` helper, register it in the in-process registry, and persist it as a
user plugin via `plugin register`. They can also register fact plugins and output
plugins. What is missing is the surrounding authoring tooling: a validated args
schema, a stable public SDK entrypoint, a scaffolding CLI, and a test harness.
This ADR records exactly what the authoring surface *is* today, what is wired but
unused, and what is reserved or absent, so future SDK work extends a documented
baseline rather than guessing.

**Scope & ownership.** ADR 0014 owns the plugin-type taxonomy
(`plugins/<type>/<namespace>/` directories) and on-disk resolution (FQCN scan,
collision policy, JIT/native bundling). This ADR (0016) owns the per-type
authoring contract and the implemented-vs-deferred status of *each* plugin type.
The type SDKs are **in scope** for this ADR; the folder-project wiring (FQCN scan
+ per-type `plugin register`) is cross-referenced to ADR 0014, not redefined here.

## Decision

### 1. The authoring surface today

The SDK authoring surface as implemented equals the union of: the `Module`
contract, the `resource()` idempotency helper, the module registry/dispatch
functions, the `plugin register`/`list` commands (module and fact types), and the
fact-plugin and output-plugin types. The per-type authoring contracts and their
current status are enumerated in §2; the type SDKs for the reserved types are
decided here (§2), while their folder-project wiring remains ADR 0014 work. The
"richer authoring surface" (validated args schema, scaffolding, harness) is future
work, owned here as work items and cross-referenced to ADR 0014 for architecture
and ADR 0015 for distribution.

### 2. Plugin types and their authoring status

Every plugin type is in explicit scope. The table below records, per type, its
current status, the authoring contract (with source path:line), whether the
folder-project model is wired, and whether `plugin register` accepts it.

| Type | Status | Authoring contract (path:line) | Folder-project wired? | `plugin register` type? |
| --- | --- | --- | --- | --- |
| modules | ✅ implemented | `Module` (`src/executor/module.ts:73-84`), `ModuleContext` (`:24-57`), `ModuleResult` (`:60-70`); `resource()` (`src/modules/resource.ts:58`) | registry only — no FQCN/collision/scanning yet (ADR 0014 work items) | yes: `--type module` |
| facts | 🟡 partial | `FactGatherer` (`src/facts/types.ts:42-55`), `FactPlugin` (`:63-68`), `registerFactPlugin` (`src/facts/engine.ts:51-55`) | no — `facts/` dir reserved | yes: `--type fact` |
| inventory | 🟡 partial | `InventoryPlugin` (`src/inventory/plugin.ts:48-51`): `name` + `resolve(ctx) → PluginContribution`; registry `registerInventoryPlugin`/`getInventoryPlugin`/`listInventoryPlugins` (`:59-69`) | no — `inventory/` dir reserved | no (built-ins `static`/`dynamic` code-registered only; `plugin list` surfaces them) |
| connection_types | 🟡 reserved | built-in `Connection` contract only (`src/transport/connection.ts:294-306`): `kind: "ssh"|"local"|"network"|"http"`, `connect`/`exec`/`facts`/`disconnect`/`health` | no | no |
| callbacks | 🟡 reserved (dir); narrower surface implemented | `OutputPlugin` (`src/cli/output.ts:21-24`): `name` + `render(data: CliResult): string`; registry (`:29-41`); `renderOutput` (`:47`); built-ins `human_summary`/`syslog`/`json` | no | no (code-registered; selected via `-o/--output`; NOT persisted or listed by `plugin list`) |

Two rows are non-obvious. **inventory** has a working interface and shipped
built-ins (`static`, `dynamic`, plus `createDynamicFilePlugin`/`createDynamicEnvPlugin`
in `src/inventory/plugin.ts`) but is **not** wired to the folder-project
plugin-type model — it is code-registered only. **callbacks** is reserved as a
directory in ADR 0014, but the implemented "callback" surface today is the `-o`
output plugins, which is **narrower** than that reserved `callbacks/` dir.

**Type-SDK decision (explicit).** The authoring contract for the two reserved
types — `connection_types` and `callbacks` — will mirror the existing built-in
interfaces: `Connection` (`src/transport/connection.ts:294-306`) for connection
types and `OutputPlugin` (`src/cli/output.ts:21-24`) for callbacks. Defining
those contracts is in scope here; wiring them (directory scanning + `plugin
register` types) is a work item cross-referenced to ADR 0014, not redefined here.

### 3. The `Module` contract

`src/executor/module.ts:73-84` defines `Module` with fields `name: string`,
`run(ctx): Promise<ModuleResult>`, `facts?: readonly VarManifestEntry[]`, and
`factGatherer?: FactGatherer`. Only `run` is required. `ModuleContext`
(`:24-57`) is passed to `run`, and `ModuleResult` (`:60-70`) carries the changed
fields (`failed?`, `skipped?`, `stdout?`, `stderr?`, `msg?`, `data?`, `halt?`).
`UndooableModule` plus the `isUndoableModule` guard (`:94-103`) mark modules that
can roll back.

### 4. The `resource()` helper

`src/modules/resource.ts:58` exports `resource(opts)`, which lifts a
`describe`/`converge` pair into a `Module` whose `run` observes-then-reconciles
and also exposes `check`. The supporting types are `DescribeResult` (`:16-21`)
and `ResourceOptions` (`:24-49`). Note that `describe`/`converge` are a
helper-level concept, not fields on the bare `Module` contract.

### 5. Registry and dispatch

`registerModule` (`src/executor/module.ts:113-122`) does a silent
`registry.set` overwrite with no collision guard; `getModule` (`:125-127`) and
`listModules` (`:161-170`) read it back. `registerAllModules()`
(`src/modules/builtins/index.ts:82-248`) is invoked by the `playbook` command
(`src/cli/commands/playbook.ts:131`) and the `docs` command
(`src/cli/commands/docs.ts:29`). There is no FQCN or collision policy today;
those are ADR 0014 work items, not redefined here.

### 6. Module discovery metadata

`meta`/`examples` are not on the `Module` interface. They live on a parallel
`ModuleSummary` type (`src/modules/search.ts:12-31`) attached externally, e.g.
`(mod as Module & { meta: ModuleSummary }).meta = meta`
(`src/modules/builtins/set_fact.ts:38`), copied into a search map via
`setModuleMeta`. `ModuleSummary.args` is a plain documentation-only
`Record<string,{type,required,description}>` (`:22`) and is not validated.

### 7. Plugin register/list and persistence

`src/cli/commands/plugin.ts` (`runPluginCommand`) handles `list`/`register`/
`remove` with `--path`, `--global`, and `--type module|fact`. Persistence lives
in `src/store/plugin-store.ts` (`registerPlugin`, `listPlugins` with
project-overrides-global, `removePlugin`) as JSON at `<root>/.rolecall/plugins.json`
or `~/.rolecall/plugins.json`. Startup auto-load `loadRegisteredPlugins()`
(`src/cli/commands/plugin.ts:29-46`, invoked at `src/cli/index.ts:230`) calls
`loadModuleFromFile` for module type and `registerFactPlugin` for fact type.

### 8. Fact plugins

`registerFactPlugin` (`src/facts/engine.ts:51-55`), `FactGatherer`
(`src/facts/types.ts:42-55`), and `FactPlugin` (`:63-68`) form the fact-plugin
types. Modules declare facts via `Module.facts`/`Module.factGatherer`, which
`registerModule` auto-registers (`src/executor/module.ts:115-121`). The mechanism
is wired, but no built-in module currently sets `facts`/`factGatherer`, so the
auto-registration path is unused by builtins.

### 9. Output plugins (the narrow callback surface)

The implemented "callback" surface is the `-o/--output` output-plugin mechanism:
`OutputPlugin` plus `registerOutputPlugin`/`getOutputPlugin`/`listOutputPlugins`
in `src/cli/output.ts:21-51`. This is narrower than ADR 0014's reserved
`callbacks/` type dir (see §2).

### 10. Scaffolded or absent (cross-cutting, not per-type)

The per-type status is the §2 table; the cross-cutting absences are:
- There is no `src/modules/sdk` directory, no Zod schema for module args (args
  are unvalidated at registration, contrast ADR 0003), and no plugin/module
  scaffolding CLI or dedicated authoring/test harness; `meta`/`examples` are
  authored manually.
- FQCN resolver, collision guard, role-local `modules/` scanning, and JIT/native
  bundling are ADR 0014 work items, referenced here, not redefined.
- `connection_types/` and `callbacks/` plugin-type dirs are reserved, not
  user-extensible (per ADR 0014); their authoring contracts are decided in §2 but
  their folder-project wiring is not yet present.

## Consequences

**Positive**
- A module author has a concrete, working contract (`Module` + `resource()`) and
  a real registration/persistence path (`plugin register`/`list`).
- Fact-plugin, output-plugin, and public SDK types (barrels `src/modules/index.ts`
  and `src/modules/registry.ts`) exist and are wired into startup auto-load.
- Every plugin type now has an explicit, owned status and authoring contract in
  this ADR, so the reserved types (`connection_types`, `callbacks`) have a defined
  SDK shape rather than being silently deferred.

**Negative / risk**
- `registerModule` silently overwrites on name collision; without the ADR 0014
  FQCN/collision guard, a user plugin can clobber a builtin by bare name.
- Module args are documentation-only and unvalidated, so authoring errors surface
  only at runtime.
- The fact-plugin auto-registration path is exercised by no built-in module, so
  it is untested in the shipped surface.
- `inventory` and `connection_types`/`callbacks` are not wired to the
  folder-project model; only `modules` and `facts` accept `plugin register`, and
  the only callback surface is the narrow `-o` output plugin.

**Work items (implementation, not in this ADR)**
1. A Zod-validated module-args schema (replacing the documentation-only
   `ModuleSummary.args`).
2. A stable `src/modules/sdk` public entrypoint for the authoring surface.
3. A scaffolding/authoring CLI plus a dedicated test harness.
4. Wire folder-project scanning + `plugin register` types for
   `facts`/`inventory`/`connection_types`/`callbacks` (cross-referenced to ADR 0014).
5. Wire at least one built-in module to `facts`/`factGatherer` to exercise the
   auto-registration path.

## References
- `src/executor/module.ts` (Module contract, ModuleContext, ModuleResult, UndooableModule, registry), `src/modules/resource.ts` (resource() helper)
- `src/modules/search.ts` (ModuleSummary), `src/modules/loader.ts` (loadModuleFromFile), `src/modules/index.ts` + `src/modules/registry.ts` (SDK barrels)
- `src/cli/commands/plugin.ts`, `src/store/plugin-store.ts` (plugin register/list + persistence), `src/cli/index.ts` (auto-load)
- `src/facts/engine.ts`, `src/facts/types.ts` (fact-plugin types)
- `src/inventory/plugin.ts` (InventoryPlugin + built-ins `static`/`dynamic`/`createDynamicFilePlugin`/`createDynamicEnvPlugin`)
- `src/transport/connection.ts` (Connection contract), `src/cli/output.ts` (OutputPlugin surface)
- ADR 0014 (project & plugin architecture), ADR 0015 (collections & distribution), ADR 0010 (connection-driven fact gathering), ADR 0013 (removed `$fact`), ADR 0003 (Zod-driven agent surface)
