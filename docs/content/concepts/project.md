---
title: Project
---

A RoleCall project is a directory that bundles your playbooks, inventory, your own modules, and reusable roles, plus a `rolecall.yaml` project manifest. This page describes the on-disk layout and how the pieces relate. It mirrors an Ansible project but is JS/TS-first.

## Minimal layout

```text
my-site/
  rolecall.yaml            # project manifest (name only)
  playbooks/
    site.yaml         # the playbook(s) you run
  inventory/
    inventory.yaml    # hosts (+ group_vars/ host_vars/ if you use them)
  plugins/            # your own project plugins (scanned at playbook run)
    modules/
      myorg/
        example-resource.ts
  group_vars/         # shared variables (optional)
  host_vars/          # per-host variables (optional)
  roles/              # reusable roles (optional)
```

Run it with:

```sh
rolecall playbook run playbooks/site.yaml --inventory inventory/inventory.yaml
```

See `examples/nginx-baseline/` in the repository for a copy-able sample.

## `rolecall.yaml` (manifest)

```yaml
name: my-site
```

`rolecall.yaml` names the project; it does not carry a dependency list. Dependencies are declared separately in `collections.yml` and hydrated with `rolecall collections install` — see the [Project Structure](/guide/project-structure) guide.

## Modules

A module is a TypeScript function built on the idempotency helper. Project modules live at `plugins/modules/<namespace>/<name>.ts` and are discovered when you run `playbook run`. Reference one from a task by its FQCN (`module: myorg.example-resource`) or by its bare name when that name is unambiguous; builtins reserve their bare names. The module name is the task key in the collapsed Ansible-style form. See [Modules](./modules.md).

## Roles

A role is a full RoleCall project you reuse. Keep local roles in `roles/`. See [Roles](./roles.md).

## Where state lives

Each project gets its own `state.db` colocated under `.rolecall/`. When `ROLECALL_DB_URL` is set, RoleCall uses a shared Postgres database instead.

## Related concepts

- [Playbooks](./playbooks.md) — the file you actually run.
- [Plays](./plays.md) and [Tasks](./tasks.md) — the building blocks inside a playbook.
- [Inventory](./inventory.md) — where the hosts come from.
- [Variables](./variables.md) and [Facts](./facts.md) — the data tasks read and write.
