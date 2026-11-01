---
title: Roles
---

A **role** is a reusable bundle of tasks you compose into a parent playbook. It ships
its own tasks, handlers, defaults, vars, templates, and files, but it does not carry a
real inventory — the parent project supplies the actual hosts.

Roles are the primary reuse mechanism: write a web-tier once, then drop it into many
playbooks.

## Layout

RoleCall resolves a role by name from `roles/` next to the playbook or at the
project root. The role directory needs `tasks/main.yml`; every other file is
optional:

```text
my-site/
  roles/
    web-tier/
      tasks/main.yml          # required: a YAML list of tasks
      handlers/main.yml       # optional: handlers with `listen`
      defaults/main.yml       # optional: lowest-precedence vars
      vars/main.yml           # optional: role vars
      templates/              # optional: role-relative templates
      files/                  # optional: role-relative source files
```

A role is host-agnostic: its vars are merged into the play, but the resolved hosts
come from the parent's inventory.

## Composing a role into a playbook

List roles at the play level; RoleCall expands each into its tasks against the
play's `hosts`:

```yaml
# playbooks/site.yaml
- hosts: web
  roles:
    - web-tier                # local role (bare name)
    - roles/common            # or an explicit path
```

Local roles resolve by bare name from `roles/`. A path-like name (containing `/` or
starting with `.`) resolves relative to the playbook directory. Role tasks run in
listed order, and role defaults merge below play vars; two roles setting the same var
follow the same listed order (later wins).

## Sharing roles

A local role lives in a project's `roles/` tree. To reuse it across projects, copy or
vendor the role directory into the other project's `roles/` tree. See
[Project Structure](/guide/project-structure) for the on-disk layout.

## Related concepts

- [Project](./project.md) — the layout a role lives inside.
- [Playbooks](./playbooks.md) and [Plays](./plays.md) — where roles are expanded.
- [Tasks](./tasks.md) — the work a role's tasks describe.
- [Modules](./modules.md) — the units a role can invoke.
