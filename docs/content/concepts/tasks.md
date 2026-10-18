---
title: Tasks
---

A **task** is a single unit of work: one module invocation, optionally combined with operators that control when it runs, how often, and what to do with the result. Every task has a `name` and names a module.

## Referencing a module

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

The module's arguments are its own schema (see [Modules](./modules.md)); anything outside the documented fields is rejected.

## Operators

Tasks may carry these first-class operators (not module args):

- `when` — a typed predicate; the task is skipped when it evaluates false. See [Playbook operators](./playbook-operators.md).
- `loop` — repeats the task once per item; inside the body, `loop.item` is the current element and `loop.index` is its position.
- `register` — stores the task result under a name; read it later via the `reg` namespace (e.g. `reg.myresult.data.stdout`, `reg.myresult.data.rc`).
- `notify` / `listen` — attach the task to a handler; handlers run on-change, are de-duplicated, and flush once at the end of the play.
- `delegate_to` — run the task against a different target than the play's hosts.
- `run_once` — execute only once (on the first host), not per host.
- `become` / `become_user` — escalate privileges for the task (e.g. `become: true`, `become_user: root`).
- `tags` — labels used by the global `--tags` / `--skip-tags` flags to select tasks (see [Tags](#tags)).

## Handlers

A handler is a task that runs only when a normal task notifies it. Declare handlers in the play's top-level `handlers:` list, and notify them by `name`:

```yaml
- hosts: web
  tasks:
    - name: update nginx config
      module: copy
      args:
        src: nginx.conf
        dest: /etc/nginx/nginx.conf
      notify: restart nginx
  handlers:
    - name: restart nginx
      module: service
      args:
        name: nginx
        state: restarted
```

Each `handlers:` entry is an ordinary task (same fields as a task entry) lowered at load time into a task carrying `listen` defaulting to its `name`. A notifying task matches by name; a handler is de-duplicated and flushed once, after the play's normal tasks finish. Handlers never run in the main task loop, and a handler that is never notified never runs. An explicit `listen:` on a handler overrides the default topic while the handler is still matched by its `name`. Handlers fire only when the notifying task actually reported `changed` (Ansible semantics) — a no-change run leaves handlers dormant.

## Tags

A task or play may carry `tags:` — a list of labels used to select which tasks run:

```yaml
- hosts: web
  tags:
    - config
  tasks:
    - name: install nginx
      module: apt
      args:
        name: nginx
        state: present
      tags:
        - install
    - name: write nginx config
      module: copy
      args:
        src: nginx.conf
        dest: /etc/nginx/nginx.conf
      tags:
        - config
```

Select tasks at run time with the global flags (see [Global Options](../reference/global-options.md)):

- `--tags <a,b>` runs only tasks carrying any listed tag; tasks with no matching tag — including untagged tasks — are skipped.
- `--skip-tags <a,b>` excludes tasks carrying any listed tag. When both flags match the same task, `--skip-tags` wins.

Tag inheritance is **replace, not union**. A task that declares no `tags:` inherits the play's `tags:`. A task that declares any `tags:` uses only its own — the play's tags do not also apply. This is a deliberate divergence from Ansible, which unions play and task tags; RoleCall keeps the simpler rule so a task's own tagging is unambiguous.

Handlers follow a special rule. A notified handler still flushes under `--tags` (handlers are exempt from tag *inclusion*). A handler is excluded by `--skip-tags` only when it explicitly declares its own `tags:` that intersect the skip list; tags a handler merely inherits from its play never exclude it.

Tag selection runs against the fully-resolved task list — after role composition and `include_tasks` expansion — so a tagged task contributed by a role or an included file is selected exactly like one written inline. A task skipped by tag selection is reported as skipped with reason `tag-filtered` rather than run.

## Lifecycle (what happens when a task runs)

1. Evaluate `when`. If false, the task is skipped and its operators stop here.
2. Expand `loop`. For each item, `loop.item`/`loop.index` enter the render scope; without `loop` there is a single iteration.
3. Resolve arguments. Bare strings stay literal; structured refs (`$var`/`$concat`/`$call`/`$template`) and typed `when`/`loop` resolve against the reserved namespaces (e.g. `vars`, `facts`). See [Playbook operators](./playbook-operators.md).
4. Run the module. It first `describe`s current state, then `converge`s only when needed — this check-compare-write cycle is what makes tasks idempotent. See [Idempotency](./idempotency.md).
5. Store the result under `register` if set.
6. If the task reported `changed`, fire any `notify`'d handlers (de-duplicated, flushed once at end of play).

## How tasks differ from Ansible

- **`register` works** and is read via the `reg` namespace (e.g. `reg.myresult.data.stdout`), not by mutating the live var scope.
- **`when` / `loop` use RoleCall operators** (`$if`, `$each`, …), not Ansible's `when:` string eval or `with_*`.
- **Privilege is `become` / `become_user`**, the same idea as Ansible's become.
- **`meta` control flags are partially honored**: `meta: end_play` / `end_host` are acted on by the executor (they halt the play or current host); `end_batch` / `refresh_inventory` / `flush_handlers` are surfaced in `data.meta.deferred` and not yet acted on.
- **Idempotency is built in**: the `shell` module requires a guard (or `run_mode`) rather than relying on `changed_when`. See [Shell & idempotency](./shell-idempotency.md).

## Related concepts

- [Modules](./modules.md) — the units of work a task invokes.
- [Playbook operators](./playbook-operators.md) — the `$var`/`$when`/`$loop` system.
- [Plays](./plays.md) — the host binding that owns the task list.
- [Shell & idempotency](./shell-idempotency.md) — the most common module and its guard rules.
