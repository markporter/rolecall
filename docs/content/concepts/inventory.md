---
title: Inventory
---

Inventory describes the hosts and groups RoleCall operates on, along with their variables. At the top level a RoleCall-native file must name a `groups` record; each group carries a `hosts` list, optional `vars`, and optional `children` (the names of its child groups). The document root may also carry `host_vars`, a map of per-host variables keyed by hostname. That grouped shape is enforced by the schema for native files.

Ansible inventories are consumed directly, with no conversion step. Every inventory-consuming command — `inventory show`/`list`, `playbook run --inventory`, `facts gather <inv>`, and `vars trace --inventory` — auto-detects the format: a `.ini` extension (or a first line starting with `[`) is Ansible INI; otherwise the YAML root decides, where an `all` key with no `groups` key is Ansible's canonical layout and anything else (including `groups:`) is native. The Ansible `all:` layout is therefore recognized rather than rejected, and both Ansible forms normalize into the same `groups`/`children`/`host_vars` model shown below. You can inspect resolution directly with `rolecall inventory show <inv>` and `rolecall inventory list <inv>`.

The group hierarchy is expressed with `children:`, matching Ansible's tree rather than flattening descendants into an ancestor's host list:

```yaml
groups:
  web:
    hosts:
      - web1.example.com
    vars:
      env: prod
    children:
      - web_edge
  web_edge:
    hosts:
      - edge1.example.com
    vars:
      env: edge
host_vars:
  edge1.example.com:
    env: host
```

RoleCall resolves target patterns into a deterministic per-host variable map. Recognized patterns include the literal host name, a glob such as `web*` that matches both host and group names, a bare group name for its members, `<group>:children` for recursive descendants, and `all` for every known host. Variable precedence runs lowest to highest as defaults, then group-all vars applied to everyone, then the group vars of the host's memberships merged root-first through the `children` tree — ancestors before descendants, so a child group overrides its parent — and finally `host_vars` and explicit host vars on top. Groups with no parent/child relationship among them merge in sorted-name order, so inventories that declare no `children:` resolve exactly as before.

Output is deliberately stable: host names and var keys are sorted before the resolved map is returned, so lines match across runs and test snapshots. Dynamic plugins can contribute extra hosts, groups, vars, and children. Fact gathering over these hosts runs live through each host's built connection, and transport (SSH/local/network) reaches them directly. Ansible consumption is limited to static files: host-range syntax (`host[01:05]`) and dynamic inventory scripts/plugins are out of scope. See [Inventory Commands](/reference/inventory-commands) for the commands that expose all of this.
