---
title: Project Structure
---

# Project Structure

This guide describes how to lay out a RoleCall project: where playbooks, inventory,
your own modules, and reusable roles live. It mirrors an Ansible project but is
JS/TS-first.

> **Status note:** RoleCall's executor is live — `rolecall playbook run` applies state over SSH/local
> transports against resolved targets. The layout
> below is the target shape; tooling that drives it is being built behind the seams
> described in `design/decisions/0014-project-and-plugin-architecture.md` (and `design/decisions/0015-collections-and-install-commands.md` for distribution).

## A minimal project

```text
my-site/
  rolecall.yaml            # project manifest
  playbooks/
    site.yaml         # the playbook(s) you run
  inventory/
    inventory.yaml    # hosts (+ group_vars/ host_vars/ if you use them)
  plugins/            # project-local plugins (scanned at playbook run)
    modules/
      <namespace>/
        example-module.ts
  group_vars/         # shared variables (optional)
  host_vars/          # per-host variables (optional)
```

Run it with:

```sh
rolecall playbook run playbooks/site.yaml --inventory inventory/inventory.yaml
```

RoleCall scans a `plugins/` tree at `playbook run` time. A
plugin's fully-qualified name (FQCN) is `<namespace>.<name>`, implied by its
directory under `plugins/<type>/<namespace>/<name>.ts` (supported types: `modules`,
`connection_types`, `callbacks`, `inventory`, `facts`; only `modules` is dispatched
today). Reference a project module from a task as `module: myorg.firewall`. Builtins
reserve their bare names (`copy`, `shell`, `file`, and so on), so a user plugin is
reachable by FQCN or by its bare name only when that bare name is unambiguous; an
ambiguous bare reference is an error you fix by writing the explicit FQCN. See
[/reference/writing-a-plugin](/reference/writing-a-plugin) for the full layout and
resolution rules.

See `examples/nginx-baseline/` in the repository for a copy-able sample.

## `rolecall.yaml` (manifest)

```yaml
name: my-site
```

`rolecall.yaml` names the project. It does not carry a dependency list; dependencies
on other RoleCall projects are declared separately in `collections.yml` (see below).

## Collections (dependencies)

A dependency is simply another RoleCall project. You declare the projects you depend
on in `collections.yml`, giving each a name, a version or git ref, and a source:

```yaml
# collections.yml
collections:
  - name: rolecall-nginx
    source: github.com/myorg/rolecall-nginx
    ref: v1.2.0
  - name: rolecall-apt
    source: github.com/myorg/rolecall-apt
    ref: main
```

Hydrate them into the local `collections/` working copy with:

```sh
rolecall collections install
```

`collections/` is the resolved, gitignored checkout of your dependencies. There is
no npm `imports:` list and no `node_modules` graph. Discovery rides on the web: a
git repository plus its README and git topics advertise what a collection provides.
Reference a collection's modules and roles by name from your playbooks, just as you
would a local `plugins/` or `roles/` entry.

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

Reference it from a playbook task with `module: myorg.example-resource` (local
`plugins/`) or `"rolecall-nginx/install":` (a module from an installed collection) — the module name
is the task key (collapsed Ansible-style form).

Share a module by factoring it into its own RoleCall project (a collection) and listing
that project in `collections.yml`, rather than publishing an npm package.

## Roles (reusable projects)

A role is a *full RoleCall project* you can reuse. Keep local roles in `roles/`:

```text
my-site/
  roles/
    web-tier/               # a local role
      rolecall.yaml             # its own manifest
      plugins/modules/
        <namespace>/
          enable-site.ts
      playbooks/site.yaml  # its entry playbook
```

Compose a role into a parent playbook:

```yaml
# playbooks/site.yaml
- roles:
    - web-tier                # local role (bare name)
    - rolecall-nginx               # role provided by an installed collection
```

Roles are host-agnostic: they ship `group_vars/`/`host_vars/` defaults but not a
real inventory. The parent project supplies the actual hosts. A role you want to
reuse across projects is itself a RoleCall project; publish it as a collection and pull
it in through `collections.yml` rather than as an npm package.

## Bootstrapping with the wizard

`rolecall --create-project` (planned) walks you through scaffolding the layout above
and seeds a sample module.

## Where state lives

Each project gets its own `state.db` colocated under `.rolecall/` (or `<cwd>/.rolecall` when
no project root is detected). When `ROLECALL_DB_URL` is set, RoleCall uses shared Postgres
instead. See `design/decisions/0006` for the storage model.
