---
title: Plays
---

A **play** is one entry in a playbook: it binds a set of hosts to an ordered list of tasks. A playbook file is always a top-level YAML **list of plays** — Ansible's document form. Multiple plays run top-to-bottom, and each play re-selects its own hosts. A bare single-play object (a mapping root with no leading `- `) is **rejected** at load time with a list-required error, so wrap every play in the top-level list.

A play is the unit of *targeting* — it answers "which hosts?" and "in what order?". The actual work is described by its [tasks](./tasks.md).

## Fields

- `hosts` (required) — a host, group, or list of them (coerced to a list). See [Inventory](./inventory.md).
- `name` (optional) — a human label for the play.
- `vars` (optional) — variables scoped to the play; available to every task in it.
- `vars_files` (optional) — ordered play-relative YAML maps merged into `vars`; later files override earlier ones and explicit `vars:` wins over all of them. See [Variables](./variables.md).
- `pre_tasks` / `post_tasks` (optional) — task lists that run before role-composed + play tasks and after every normal task respectively (handlers still flush at end of play).
- `gather_facts` (optional) — accepted for Ansible compatibility and preserved on round-trip; RoleCall always gathers facts lazily, so it does not change behavior.
- `tasks` (required) — the ordered list of task entries.
- `handlers` (optional) — a list of task-shaped handler entries, lowered at load time into `listen` tasks that run only when a task `notify`s them by name. See [Tasks](./tasks.md#handlers).
- `trigger` (optional) — a schedule / cron / webhook descriptor, preserved on round-trip. The orchestrator's cron scheduler consumes schedules created through `/schedules`; a play-level `trigger:` is not auto-registered today. See [Serve Command](/reference/serve-command).
- `serial` / `strategy` (optional, play-level) — see below.

## Hosts and inventory

`hosts` names targets through the inventory: a literal host name, a glob like `web*` (matches both hosts and groups), a bare group name for its members, `<group>:children` for recursive descendants, or `all` for every known host. See [Inventory](./inventory.md).

## Strategy and serial

- `strategy: linear` (default) — all targeted hosts advance through the task list together, gated so a failed host stops its own downstream tasks.
- `strategy: free` — each host runs the play independently at its own pace.
- `serial: N` — apply to at most `N` hosts at a time (batches), instead of all at once.

These are **play-level** settings, not task-level.

## Play variables and precedence

`vars:` declared on a play sit between inventory host/group vars and runtime `--extra-vars` in the precedence stack. See [Variables](./variables.md) for the full order.

## Related concepts

- [Tasks](./tasks.md) — what a play runs.
- [Playbooks](./playbooks.md) — the file that lists plays.
- [Roles](./roles.md) — reusable units you can drop into a play's host set.
- [Project](./project.md) — how plays live inside a project layout.
