---
title: Inventory Commands
---

Inventory commands inspect the hosts, groups, and variables RoleCall targets.

There are two actions, both implemented end to end without any transport layer: `show` and `list`. Reach them with `rolecall inventory show <inv>` and `rolecall inventory list <inv>`; anything past that errors with `unknown inventory subcommand '...' (expected: show | list)`.

`inventory list` answers the simplest question, which groups exist. Against `tests/fixtures/inventory.valid.yaml` it prints:

```text
Inventory: tests/fixtures/inventory.valid.yaml
Groups (2): db, web
```

`inventory show` goes further and resolves every host (the implicit `all` target), printing merged per-host variables sorted deterministically:

```text
Inventory: tests/fixtures/inventory.valid.yaml
Hosts (3):
  - db1.example.com: 
  - web1.example.com: role="web"
  - web2.example.com: role="web"
```

## Native and Ansible inventories

Every inventory-consuming command (`inventory show`/`list`, `playbook run --inventory`, `facts gather <inv>`, and `vars trace --inventory`) accepts BOTH RoleCall's native `groups:` YAML and Ansible inventories directly — there is no conversion step. The loader auto-detects the format from the file's extension and content:

1. A `.ini` extension, or content whose first non-blank, non-comment line starts with `[` (an Ansible `[group]` header), is parsed as Ansible INI.
2. Otherwise the text is parsed as YAML. A mapping root carrying an `all` key and no `groups` key is Ansible's canonical layout and is parsed as Ansible YAML.
3. Any other YAML root — including a `groups:` root — is RoleCall-native and validated against the strict schema, exactly as before.

Ansible INI supports `[group]` host lists (with inline `host key=value` vars), `[group:children]` subgroups, `[group:vars]` group vars, `#`/`;` comments, blank lines, and quoted values. Ansible YAML supports `all.children` / `all.vars` nesting, top-level `children:`/`vars:`/`hosts:`, and per-host var maps.

Both Ansible forms normalize into the same shape as native inventory: the group tree is preserved as `children:` (not flattened) and per-host vars become document-root `host_vars`. So `inventory show` on an Ansible INI file such as `tests/fixtures/ansible-inventory.ini` prints directly:

```text
Inventory: tests/fixtures/ansible-inventory.ini
Hosts (4):
  - db1.example.com: region="us-east"
  - edge1.example.com: env="production" region="us-east" retries=3 role="web"
  - web1.example.com: ansible_user="deploy" env="production" http_port=80 region="us-east" retries=3 role="web"
  - web2.example.com: env="production" region="us-east" retries=3 role="web"
```

The engine resolves the tree with Ansible precedence: a host's group vars merge root-first (ancestors before descendants, so a child group overrides its parent), and per-host `host_vars` apply last, above every group var. Groups with no parent/child relationship among them still merge in sorted-name order, so inventories that use no `children:` at all resolve exactly as before.

## Known limitations

- No Ansible range syntax in host lines (`host[01:05]`); each host must be listed explicitly.
- Dynamic inventory scripts/plugins are out of scope — only static INI and YAML files are consumed.
- A bare Ansible YAML root other than `all:`/`children:`/`vars:`/`hosts:` is read as a top-level group map; a `groups:` root is always RoleCall-native.

See [Inventory](/concepts/inventory) for the underlying model and [Variables](/concepts/variables) for var precedence.
