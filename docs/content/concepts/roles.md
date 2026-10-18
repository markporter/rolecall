---
title: Roles
---

A **role** is a reusable RoleCall project you compose into a parent playbook. It ships its own modules, playbooks, and default variables, but it does not carry a real inventory — the parent project supplies the actual hosts.

Roles are the primary reuse mechanism: write a web-tier once, then drop it into many playbooks.

## Layout

```text
my-site/
  roles/
    web-tier/               # a local role
      rolecall.yaml             # its own manifest
      plugins/modules/
        <namespace>/
          enable-site.ts
      playbooks/site.yaml  # its entry playbook
      defaults/            # default var manifests
```

A role is host-agnostic: it can ship `group_vars/`/`host_vars/` *defaults*, but the resolved hosts come from the parent's inventory.

## Composing a role into a playbook

List roles at the play level; RoleCall expands each into its tasks against the play's `hosts`:

```yaml
# playbooks/site.yaml
- hosts: web
  roles:
    - web-tier                # local role (bare name)
    - rolecall-nginx               # role provided by an installed collection
```

Local roles resolve by bare name from `roles/`. Collections are declared in `collections.yml` and hydrated with `rolecall collections install`; reference their roles by collection name.

## Sharing roles

Promote a local role by factoring it into its own RoleCall project (with its own `rolecall.yaml`) and listing it in `collections.yml`. Consumers hydrate it with `rolecall collections install` and reference it by name from a play's `roles:` list. See [Project](./project.md) for the manifest format.

## Related concepts

- [Project](./project.md) — the layout a role lives inside.
- [Playbooks](./playbooks.md) and [Plays](./plays.md) — where roles are expanded.
- [Tasks](./tasks.md) — the work a role's playbooks describe.
- [Modules](./modules.md) — the units a role can bundle.
