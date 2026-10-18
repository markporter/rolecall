---
title: Playbooks
---

A playbook is a YAML file that declares the desired state RoleCall drives targets toward. It is an ordered list of **plays**; each play names a set of hosts and the **tasks** to run against them. Running `rolecall playbook run <file>` resolves the hosts, then applies the tasks live over SSH or the local transport — it does not merely print a plan.

See [Project](./project.md) for how playbooks fit into a project layout, [Plays](./plays.md) and [Tasks](./tasks.md) for the two building blocks in detail, and [Inventory](./inventory.md) for how hosts resolve.

## What a playbook contains

At the top level a playbook is a list of plays. Each play accepts:

- `hosts` (required) — a host, group, or list of them (coerced to a list). See [Inventory](./inventory.md).
- `tasks` (required) — an ordered list of task entries.
- `name` (optional) — a human label for the play.
- `vars` (optional) — variables scoped to the play.
- `trigger` (optional) — a schedule / cron / webhook descriptor. The scheduler that consumes it is scaffolded today, so treat it as declared-but-not-yet-run.
- `serial` / `strategy` (optional, play-level) — `strategy` is `linear` (default: all hosts advance through tasks together) or `free` (each host runs independently).

Every task needs at least a `name` and a module. RoleCall's shape is strict: unknown keys are rejected, so a typo fails fast at load time rather than silently being ignored.

## Task shape: collapsed vs explicit

A task can name its module as a collapsed key, or use the explicit `module:` + `args:` form — they are equivalent:

```yaml
- apt:
    name: nginx
```
```yaml
- name: install nginx
  module: apt
  args:
    name: nginx
```

## YAML quirks that matter

RoleCall reads standard YAML, but a few behaviors trip people up:

**Plain scalars.** `command: echo hi` works, but YAML reserves characters that force quoting. Quote a value with `'…'` (no escape processing) or `"…"` (processes `\"` and `\n`) whenever it contains a `:` followed by a space, a leading `-`, or any of `# [ ] { } & * ! | > % @ \``. When in doubt, quote:

```yaml
- shell:
    command: "echo http://<%= play.host %>:8080"
```

**Literal block (`|`).** Newlines are preserved verbatim — use it for multi-statement scripts and heredocs:

```yaml
- shell:
    command: |
      set -e
      echo "bootstrapping"
      touch /opt/app/.bootstrapped
    run_mode: always
```

**Folded block (`>`).** Newlines collapse to single spaces — use it to wrap a long command or prose across lines without embedding real newlines:

```yaml
- shell:
    command: >
      apt-get update &&
      apt-get install -y nginx
    run_mode: always
```

**Flow style is allowed but avoided.** `{ … }` / `[ … ]` are valid YAML. RoleCall's examples use block style for readability, so structured operators like `$each` are written as nested mappings/sequences, not inline:

```yaml
# Preferred (block style)
loop:
  $each: vars.packages
```
```yaml
# Valid YAML, but discouraged in examples
loop: { $each: vars.packages }
```

## Dynamic values: the `$operators`

Static strings are not enough — tasks branch, loop, and interpolate. RoleCall does that with **structured operators** (keys starting with `$`) plus the `when` and `loop` task fields. The full list lives in [Playbook operators](./playbook-operators.md); the essentials:

- `$var` — look up an authored variable (the `vars` namespace) or an observed fact (the `facts` namespace, e.g. `$var: facts.os`).
- `$concat` / `$template` — build a string; `$template` renders EJS (`<%= %>`).
- `when:` — a typed predicate that skips the task when false.
- `loop:` — repeats the task once per item (the current item is `loop.item`).

```yaml
- name: install only on Debian
  apt:
    name: nginx
  when:
    $eq:
      - $var: vars.os
      - "Debian"
```

## How playbooks differ from Ansible

- **`{{ }}` is not rendered.** Ansible-style `{{ }}` stays literal in values. Use `$var`/`$concat`/`$template` (EJS) for interpolation, or `copy` with `engine: jinja` when you need Jinja. See [Templating](./templates.md).
- **`hosts` is required.** There is no implicit `localhost` or `all`; name your targets explicitly (or via groups — see [Inventory](./inventory.md)).
- **Idempotency is by design.** The `shell` module requires a guard (or an explicit `run_mode`) instead of Ansible's `changed_when`. See [Shell & idempotency](./shell-idempotency.md).
- **`register` works.** It stores a task result under a name you can read later via the `reg` namespace (e.g. `reg.myresult.data.stdout`).
- **Strict shape.** Unknown keys are rejected, so a mistyped field fails at load time.
- **`meta` control flags are partially honored.** `meta: end_play` / `end_host` are honored by the executor (they halt the play or current host); `end_batch` / `refresh_inventory` / `flush_handlers` are surfaced in `data.meta.deferred` and not yet acted on.
- **`serial` / `strategy` are play-level**, not task-level.

## Where to go next

- [Tasks](./tasks.md) — the module invocation plus its operators.
- [Plays](./plays.md) — hosts, vars, and play-level strategy.
- [Roles](./roles.md) — reusable, composable units of a project.
- [Project](./project.md) — the on-disk layout of a RoleCall project.
