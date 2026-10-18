---
title: Variables
---

Variables are values RoleCall resolves and exposes to templates. They are distinct from
**facts**, which RoleCall observes from a target at gather time. Every variable is read
through the single `$var` operator as a fully-qualified `namespace.key` path:

```yaml
- name: write vhost
  copy:
    dest:
      $var: vars.vhost_path
    content:
      $template: "listen <%= vars.nginx_port %>;\n"
```

The first segment of the path selects one of nine reserved namespaces. The namespaces
keep authored values, observed facts, registered results, loop context, and run
metadata clearly separated so it is always obvious where a value came from.

## The nine namespaces

| Namespace | What it holds |
| --- | --- |
| `vars` | Authored variables — the precedence-merged result of playbook/role/inventory/`--extra-vars`. |
| `facts` | Values observed from the target at gather time (OS, hostname, IPs, service state). |
| `reg` | Results of tasks that used `register:`, keyed by the register name. |
| `loop` | The current loop iteration's `item` and `index`. |
| `play` | Context for the running play and host (`host`, `hosts`, `groups`, `roles`, `name`, `path`). |
| `inv` | The full, source-attributed inventory snapshot (raw host/group vars, not merged). |
| `role` | Context for the role currently executing (`name`, `path`). Empty when not in a role. |
| `run` | Run/invocation metadata (`id`, `started_at`, `forks`, `limit`, paths). |
| `rolecall` | Platform constants for this build (`version`, `runtime`, `ansible_compat`). |

### `vars` — authored variables

The `vars` namespace is the precedence-merged result of everything you author: playbook
`vars:`, role `vars`/`defaults`, inventory `group_vars`/`host_vars`, and `--extra-vars`.
It is a flat map (`Record<string, unknown>`), so a key declared in a higher tier hides
the same key from a lower tier. Example: `$var: vars.nginx_port`, `$var: vars.app_env`.

### `facts` — observed facts

`facts` holds values RoleCall gathers from the target over its `Connection` at gather time —
for example `os`, `kernel`, `arch`, `hostname`, `ip_addresses`, and `service_status`.
It is a flat map (`Record<string, unknown>`). Facts are deliberately separate from
`vars` so observed and authored values never collide. Example: `$var: facts.os`,
`$var: facts.hostname`.

### `reg` — registered task results

When a task sets `register: <name>`, its result is stored under `reg.<name>`. Each entry
is a `ModuleResult`. You can also create runtime register values outside of a task result
with the `set_reg` module (the `reg`-namespace counterpart to `set_fact`): each key in its
args is persisted live to `reg`, so downstream tasks read it with `$var: reg.<name>`.

**`set_reg` vs `set_fact`** — prefer `set_reg` for runtime scratch variables: cached
tokens, computed intermediates, or any value you want to hand off between tasks that is
not actually a property of the host. Reserve `set_fact` for values that are genuinely a
persistent fact about the host — information RoleCall would otherwise observe at gather time
(OS, network, installed state). Keeping runtime temporaries in `reg` makes the intent
explicit and leaves the `facts` namespace reserved for host state.

```yaml
changed: true
failed: false
skipped: false
stdout: "...command output..."
stderr: ""
msg: "ok"
data:
  count: 3
  items:
    - a
halt: false
```

Read it back with `$var: reg.<name>.stdout`, `$var: reg.<name>.changed`, or
`$var: reg.<name>.data.count`. `reg` accumulates as the play runs — a task can only see
registers from tasks that already executed on the same host.

### `loop` — iteration context

Inside a `loop:`, `loop.item` is the current element and `loop.index` is its 0-based
position (`{ item?: unknown; index?: number }`). Example: `$var: loop.item`,
`$var: loop.index`. In `$template` ETA content, `item` and `index` are also exposed as
top-level locals for convenience.

### `play` — play and host context

`play` describes the running play and the host currently being targeted:

```yaml
host: web1
name: deploy
hosts:
  - web1
  - web2
groups:
  - web
roles:
  - nginx
path: /abs/path/playbook.yaml
```

Example: `$var: play.host`, `$var: play.roles`, `$var: play.groups`.

### `inv` — inventory snapshot

`inv` is the whole inventory, source-attributed and **not** precedence-merged — use it
when you need the raw host/group vars or want to see which group a value came from:

```yaml
hosts:
  web1:
    vars:
      datacenter: dc1
    groups:
      - web
groups:
  web:
    hosts:
      - web1
    vars:
      nginx_port: 80
defaults: { }
```

Example: `$var: inv.hosts.web1.vars.datacenter`, `$var: inv.groups.web.vars.nginx_port`.

### `role` — current role context

When a task executes inside a role, `role` carries that role's context (`{}` otherwise):

```yaml
name: nginx
path: /abs/path/roles/nginx
ancestors: []
```

Example: `$var: role.name`.

### `run` — run / invocation metadata

`run` describes the current invocation:

```yaml
id: local
started_at: "2026-10-11T12:00:00.000Z"
epoch: 1760000000000
playbook_path: /abs/path/playbook.yaml
inventory_path: /abs/path/inv.yaml
limit: web1
forks: 10
```

Example: `$var: run.id`, `$var: run.forks`, `$var: run.limit`.

### `rolecall` — platform constants

`rolecall` exposes build/platform constants:

```yaml
version: 0.0.0
runtime: bun
ansible_compat: false
```

Example: `$var: rolecall.version`, `$var: rolecall.ansible_compat`.

## Declaring variables with a manifest

A `vars.*` reference is validated against a **var manifest** — a layered set of entries,
each with a `name`, a `kind` (`var` or `fact`), a `source` (`declared` or `observed`),
and a `type`:

```yaml
- name: nginx_port
  kind: var
  source: declared
  type: number
  default: 80
- name: app_env
  kind: var
  source: declared
  type: string
```

Manifests are authored per role under `roles/<role>/defaults/` and merged with the
playbook-root manifest (`var-manifest.yml` beside the playbook file). A name declared in
two layers with conflicting `kind`/`source` is a hard fail, surfaced before any task runs.
A `default` lets a role ship a fallback while still requiring callers to be explicit
about overrides.

## Precedence and layering

The `vars` namespace is built from several tiers; later tiers win (lowest → highest):

1. role defaults (`roles/<role>/defaults/var-manifest.yml` default values)
2. role vars (`roles/<role>/vars/`)
3. inventory group vars (the `vars:` on each inventory group, plus `group_vars/<group>.yaml`)
4. inventory host vars (the inventory document's `host_vars:` map, plus `host_vars/<host>.yaml`)
5. playbook vars (`vars:`)
6. runtime `--extra-vars` (always wins)

Within tier 3, group vars follow the inventory `children:` hierarchy: a host's
groups are merged root-first, so a child group overrides its parent (groups with no
parent/child relationship among them still merge in sorted-name order).
Tier 4 applies above every group var, so a host's own values always win over any
group it belongs to. The `--inventory` source may be a RoleCall-native `groups:`
file or an Ansible inventory (INI or `all:`-rooted YAML); the format is
auto-detected, so no conversion is required before running or tracing.

`--extra-vars` sits at the top, so a value supplied on the command line overrides
everything — useful for promoting a fact to an override or injecting a one-off CI value.

The other namespaces are **not** precedence-layered:

- `facts` are observed at gather time and never merged with authored vars.
- `reg` accumulates as tasks register during the run.
- `inv` is a raw, source-attributed snapshot (read it when you need un-merged group/host
  vars rather than the `vars` merge).
- `loop`, `play`, `role`, `run`, and `rolecall` describe the current iteration, play, role,
  invocation, and platform — they carry a single authoritative value each.

## `var_strict` enforcement

Under `var_strict` (on by default), a `$var: vars.*` reference must resolve to a declared
manifest entry, or load fails with an `undeclared-var` problem. `var_strict` is only
enforced once at least one manifest has been discovered — a playbook with no declarations
has nothing to enforce against. Set `var_strict: false` on a play to permit undeclared
references.

The same manifest feeds the `namespace-unknown` lint: the first segment of every `$var`
must be one of the nine reserved namespaces above — so `$var: port` (no namespace) is
rejected at load time.

## Tracing which layer won

- `rolecall vars list <playbook> [-o json]` — every declared variable/fact grouped by the file
  that declared it (`declaredIn`).
- `rolecall vars trace <playbook> [--inventory <inv>] [--extra-vars <kv>] [--limit <host>]` —
  for each resolved host, the winning value, the tier/file that set it, and the full
  override chain `role-default < inv-group < inv-host < play < extra`.

Both are additive: they re-merge the same precedence tiers with origin metadata retained,
and never touch the executor's hot path.

See [Facts](/concepts/facts) for observed values and
[Vars Commands](/reference/vars-commands) for the CLI reference.
