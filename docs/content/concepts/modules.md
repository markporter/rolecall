---
title: Modules
---

Modules are small, composable units of work that tasks invoke against targets. Each one takes declared args and reports back whether the target already matched desired state, changed, failed, or was skipped.

Tasks reference a module by name — either as a collapsed key (`apt: { … }`) or explicitly via `module: apt` with `args:` — and pass structured data through that module's args.

Custom modules are authored as a plain TS export and discovered automatically: drop the file at `plugins/modules/<namespace>/<name>.ts` (the scanner also accepts `.mts`, `.js`, and `.mjs`) under the project root and RoleCall scans it at `playbook run`, dispatching it by its FQCN `<namespace>.<name>` (see [Writing a Plugin](/reference/writing-a-plugin)). This sits alongside the module registry and the batteries-included built-ins whose `describe`/`converge` behavior executes live through the executor when a playbook applies tasks. (`rolecall plugin register` remains available for a module kept outside any project, or shared machine-wide via `.rolecall/plugins.json`.) The richer plugin/module SDK authoring surface — a validated args schema, a stable public SDK entrypoint, and a scaffolding/test harness — is deferred past MVP (see ADR 0016).

Module arguments are resolved before dispatch: structured expression nodes (`$var`, `$concat`, `$call`, `$eq`, `$gt`, `$and`, …) resolve at any depth, while bare string values stay literal. The `$template` operator opts a value into RoleCall's EJS renderer. Arguments do not auto-render Jinja `{{ }}`: a literal `{{ }}` is passed through verbatim rather than evaluated. The one opt-in Jinja path is the `copy` module's `content` template spec with `engine: jinja` (the default engine there is `eta`). For how a task picks a module, read [Playbook Commands](/reference/playbook-commands); for the runtime pieces, see [Transport](/concepts/transport) and [Tasks](/concepts/tasks).
