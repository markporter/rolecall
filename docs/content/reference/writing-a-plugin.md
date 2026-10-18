---
title: Writing a Plugin
---

# Writing a Plugin (Module Authoring)

A RoleCall *module* is the unit of work the executor dispatches for each task
(`module: <name>`). This page walks through authoring one against the real
contracts in `src/executor/module.ts` and `src/modules/search.ts`, using the
canonical `file` module (`src/modules/builtins/file.ts`) as the reference
implementation.

Modules are discovered two ways:

- **Project plugins (the normal path)**: author a module as a plain TS export and
  drop it at `plugins/modules/<namespace>/<name>.ts` under the project root. RoleCall
  scans that tree at `playbook run` and dispatches it by its fully-qualified name
  (`module: <namespace>.<name>`) — there is no registration step. See the
  *Project plugins & FQCN resolution* section below.
- **Built-in / bundled**: `registerAllModules()` in
  `src/modules/builtins/index.ts` registers each shipped module object and copies
  its attached `meta` summary into the search metadata map. This is how `rolecall docs
  modules` and `searchModules()` find them.

A module that is *not* part of a project — or that you want available to every
project on the machine — can instead be persisted with `rolecall plugin register <name>
--path <file>` (see [/reference/plugin-commands](/reference/plugin-commands)).
Startup auto-loads every registered entry, so `playbook run` dispatches it by
`module: <name>`; `--global` writes to `~/.rolecall/plugins.json` instead of the
project-local `<root>/.rolecall/plugins.json`.

## Project plugins & FQCN resolution

Beyond `plugin register`, RoleCall also scans project-local plugin files at `playbook
run` time. This is the path for modules you keep in the repo rather than persisting
to the manifest.

### Layout

Project plugins live under the project root at:

```text
plugins/
  <type>/
    <namespace>/
      <name>.ts
```

The project root is the playbook file's directory, or its parent when the playbook
sits in a `playbooks/` subdir. Supported type dirs are `modules`,
`connection_types`, `callbacks`, `inventory`, and `facts` — today only `modules` is
dispatched by the executor. The scanner also discovers plugins under
`collections/<org>/<coll>/plugins/<type>/<namespace>/`.

A concrete module:

```text
plugins/
  modules/
    myorg/
      firewall.ts
```

### Fully-qualified names

A plugin's fully-qualified name (FQCN) is `<namespace>.<name>`; the type is implied
by the directory it lives under. Reference it from a task with the FQCN:

```yaml
- module: myorg.firewall
  args:
    rule: allow-ssh
```

Or the collapsed key form with an args block:

```yaml
- myorg.firewall:
    rule: allow-ssh
```

### Bare names, builtins, and ambiguity

Builtins keep RESERVED bare names: a bare `copy`, `shell`, `file`, and so on always
resolve to the builtin. `rolecall.builtin.<name>` and `ansible.builtin.<name>` also
resolve to builtins.

A user plugin is reachable by its FQCN, or by its bare name when that bare name is
unambiguous. If two user plugins share a bare name, a bare reference is AMBIGUOUS and
is an error — resolve it by writing the explicit FQCN. A plugin whose bare name matches
a builtin is not an error: the builtin keeps the bare name, and you address the plugin
by its FQCN.

Modules are eagerly loaded once when `playbook run` starts, so resolution is
synchronous at dispatch.

## The `Module` contract

Every module implements the `Module` interface:

```ts
import type { Module, ModuleContext, ModuleResult } from "../../executor/module";

export const myModule: Module = {
  name: "my_module",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    // ... do work ...
    return { changed: true, msg: "done" };
  },
};
```

`ModuleResult` fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `changed` | `boolean` | Whether state on the target changed (drives idempotency reporting). |
| `failed` | `boolean?` | Set `true` to mark the task failed. |
| `skipped` | `boolean?` | Mark the task skipped (no-op). |
| `msg` | `string?` | Human-readable status line. |
| `data` | `Record<string,unknown>?` | Optional structured output (surfaced to later tasks via `reg`). |
| `stdout` / `stderr` | `string?` | Captured stream output, when relevant. |

## `ModuleContext` — what you get per invocation

```ts
interface ModuleContext {
  readonly host: string;            // target host name
  readonly connection: Connection;  // Local or SSH connection; call conn.exec(cmd)
  readonly args: Record<string, unknown>;  // the task's `args:` block (rendered)
  readonly vars: Record<string, unknown>;  // playbook/group/host vars
  readonly facts: Record<string, unknown>; // gathered facts for this host
  readonly reg: Record<string, unknown>;   // data (registers) from prior tasks
  readonly loop?: { item?: unknown; index?: number }; // current loop item + index
  readonly signal?: AbortSignal;    // cancellation
  readonly become?: boolean;        // escalate (sudo) for this invocation
  readonly become_user?: string;    // run escalated commands as this user
  readonly environment?: Record<string, string>; // task-level env exports
  readonly no_log?: boolean;        // suppress logging for this task
  readonly roleDir?: string;        // role-relative path resolution
  readonly playbookDir?: string;    // playbook-relative path resolution
  readonly setFact?: (key: string, value: unknown) => void;  // persist a host fact live
  readonly setReg?: (key: string, value: unknown) => void;   // persist a register live
  readonly setStat?: (key: string, value: unknown) => void;  // aggregate a run stat
  readonly clearFacts?: () => void; // clear live facts for the host
  readonly resetConnection?: () => Promise<void>; // drop the cached transport
  readonly addHost?: (name: string, groups: string[], vars: Record<string, unknown>) => void;
}
```

Run commands on the target through `ctx.connection.exec(cmd)` — it returns an
object with `exitCode`, `stdout`, `stderr`. `become` (sudo) is a request you
honor yourself: prefix privileged commands (and temp-then-move writes) with
`sudo` when `ctx.become` is set.

## Attaching a `ModuleSummary`

The discovery metadata lives on the `ModuleSummary` interface
(`src/modules/search.ts`). Attach it to your module object on a `meta` property —
`registerAllModules()` reads that property and calls `setModuleMeta(...)`:

```ts
import type { ModuleSummary } from "../search";

export const meta: ModuleSummary = {
  name: "my_module",
  description: "One-line description shown by `rolecall docs modules` / search.",
  idempotent: true,                 // true if re-running is a no-op
  source: "builtin",                // "builtin" | "plugin" | "user" | "example"
  args: {
    path:    { type: "string", required: true,  description: "Destination path." },
    content: { type: "string", required: false, description: "Desired contents." },
  },
  examples: [
    `- my_module:
    path: /etc/motd
    content: 'managed by rolecall'`,
  ],
};

(myModule as Module & { meta: ModuleSummary }).meta = meta;
```

Use the collapsed Ansible-style form in `examples` (e.g. `my_module: { … }`) — **never** Jinja (<code v-pre>{{ }}</code>); that renderer
is scaffolded and left literal. The `args` record documents each parameter's
`type`, whether it is `required`, and a `description`.

## Reference implementation: idempotent write

The `file` module (`src/modules/builtins/file.ts`) is the canonical pattern:

1. **Read-then-diff.** `cat` the current file; only write when content differs.
   Strip a single trailing newline so re-runs compare equal and report
   `changed: false`.
2. **Safe quoting.** Wrap every interpolated path in a `shQuote()` helper
   (`'...'` with internal quotes escaped) so shell metacharacters can't break out.
3. **Random heredoc delimiter.** Generate `ROLECALL_EOF_<uuid>` so file contents can
   contain any bytes (including the delimiter string) without colliding.
4. **become handling.** When `ctx.become` is set, write to a user-temp file and
   `sudo mv` into place, so root-owned destinations work.

```ts
const readCmd = become
  ? `sudo cat ${shQuote(path)} 2>/dev/null`
  : `cat ${shQuote(path)} 2>/dev/null`;
const cur = await conn.exec(readCmd);
const current = cur.exitCode === 0 ? cur.stdout : null;
// ...normalize trailing newline, compare to `content`...
if (currentNorm === content) return { changed: false, msg: `${path} unchanged` };

const delim = `ROLECALL_EOF_${randomUUID()}`;
const writeCmd = `cat > ${shQuote(path)} <<'${delim}'\n${content}\n${delim}`;
const w = await conn.exec(writeCmd);
if (w.exitCode !== 0) return { changed: false, failed: true, msg: `write failed: ${w.stderr}` };
return { changed: true, msg: `${path} written` };
```

Copy this shape for any "make target state match desired state" module.

## Templating conventions in `args`

Bare strings in `args` are always literal. To bind dynamic values use the
structured-ref operators in `src/templating/refs.ts` — **never** Jinja
<code v-pre>{{ host.vars.x }}</code> (EJS's delimiters are `<%= %>` / `<% %>`):

```yaml
# bind dynamic values with structured refs — never {{ }} / Jinja
- $var: vars.x          # single lookup against the vars namespace (vars. prefix mandatory)
- $concat:
    - a
    - "-"
    - $var: vars.region # compose a string
- $template: "<%= play.host %>"   # opt-in EJS render of a literal string
```

## Runtime discovery & LLM-legibility

Once registered, your module is visible through:

- `searchModules(term)` and `getModuleSummary(name)` (`src/modules/search.ts`).
- `rolecall docs modules` / `rolecall docs search` — powered by
  `src/docs/embedded-content.ts`, which bundles the same summaries for
  agent/runtime consumption.

The developer-facing **API reference** (this site's sibling, generated by
TypeDoc with the clean-jsdoc-theme) additionally emits `docs/api/llms.txt` and
`docs/api/llms-full.txt` — machine-readable indexes of every exported symbol,
for direct ingestion by LLMs. Together, `rolecall docs` (runtime) and `llms.txt`
(static) cover both interactive and agent use.
