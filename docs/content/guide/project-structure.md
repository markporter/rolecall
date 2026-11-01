---
title: Project Structure
---

# Project Structure

This guide describes how to lay out a RoleCall project: where playbooks, inventory,
your own modules, and reusable roles live. It mirrors an Ansible project but is
JS/TS-first.

## A minimal project

```text
my-site/
  rolecall.yaml            # project manifest
  playbooks/
    site.yaml              # the playbook(s) you run
  inventory/
    inventory.yaml         # hosts (+ group_vars/ host_vars/ if you use them)
  plugins/                 # project-local plugins (scanned at playbook run)
    modules/
      <namespace>/
        example-module.ts
  roles/                   # reusable local roles (optional)
  group_vars/              # shared variables (optional)
  host_vars/               # per-host variables (optional)
```

Run it with:

```sh
rolecall playbook run playbooks/site.yaml --inventory inventory/inventory.yaml
```

RoleCall scans a `plugins/` tree at `playbook run` time. A plugin's
fully-qualified name (FQCN) is `<namespace>.<name>`, implied by its directory
under `plugins/<type>/<namespace>/<name>.ts`. The supported type directories are
`modules`, `connection_types`, `callbacks`, `inventory`, and `facts`; `modules`
are dispatched by the executor. Reference a project module from a task as
`module: myorg.firewall`. Builtins reserve their bare names (`copy`, `shell`,
`file`, and so on), so a user plugin is reachable by FQCN or by its bare name
only when that bare name is unambiguous; an ambiguous bare reference is an error
you fix by writing the explicit FQCN. See
[/reference/writing-a-plugin](/reference/writing-a-plugin) for the full layout and
resolution rules.

See `examples/nginx-baseline/` in the repository for a copy-able sample.

## `rolecall.yaml` (manifest)

```yaml
name: my-site
```

`rolecall.yaml` names the project. It does not carry a dependency list.

## Vendored dependencies

A dependency is simply another RoleCall project. Vendor the checkout under
`collections/<org>/<coll>/`, and RoleCall scans its plugins at the same time as
project-local ones:

```text
my-site/
  collections/
    myorg/
      rolecall-nginx/
        rolecall.yaml
        plugins/
          modules/
            nginx/
              install.ts
```

Reference the vendored module by its FQCN (`nginx.install`) or by its bare name
when unambiguous. There is no npm `imports:` list and no `node_modules` graph.
Roles are resolved from the local `roles/` tree; a vendored collection contributes
modules, not roles.

## Modules

A module is a TypeScript function built on the idempotency helper:

```ts
// plugins/modules/myorg/example-resource.ts
import { resource } from "rolecall/modules";

export default resource({
  describe: (args) => ({ /* current state */ }),
  converge: (args) => ({ /* desired state */ }),
});
```

Reference it from a playbook task with `module: myorg.example-resource` — the
module name is the task key in the collapsed Ansible-style form.

## Roles (reusable tasks)

A local role is a directory under `roles/` (next to the playbook or at the project
root) with a required `tasks/main.yml` plus optional `handlers/main.yml`,
`defaults/main.yml`, and `vars/main.yml`:

```text
my-site/
  roles/
    web-tier/
      tasks/main.yml         # required: a YAML list of tasks
      handlers/main.yml      # optional
      defaults/main.yml      # optional: lowest-precedence vars
      vars/main.yml          # optional: role vars
      templates/             # optional: role-relative templates
      files/                 # optional: role-relative source files
```

Compose one into a parent playbook:

```yaml
# playbooks/site.yaml
- hosts: web
  roles:
    - web-tier
```

Role defaults merge below play vars, and role tasks can resolve files relative to
the role directory. The parent project supplies the hosts; a role never carries
its own inventory. See [Roles](/concepts/roles) for details.

## Where state lives

Each project gets its own `state.db` colocated under `.rolecall/` (or
`<cwd>/.rolecall` when no project root is detected). Persistence is SQLite on both
Node.js and Bun. See `design/decisions/0006` for the storage model.
