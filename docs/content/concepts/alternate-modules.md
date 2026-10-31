# RoleCall Alternate Modules

RoleCall aims to ship the same-named modules as Ansible with the same features, *except*
where RoleCall has made a deliberate design alternative. This page documents those
alternatives and shows how to accomplish the equivalent task in RoleCall.

RoleCall does **not** render Ansible's Jinja `{{ }}` syntax. Templates use RoleCall's
structured operators (`$var`, `$concat`, `$call`, `$if`, `$each`) and EJS
`<%= %>` for arbitrary expressions. See [Shell & idempotency](./shell-idempotency.md)
and [Templating](./templates.md).

## Truly RoleCall-native (different design)

These are not 1:1 ports — RoleCall replaced the Ansible approach with a built-in design:

| Ansible concept | RoleCall alternative | Why | How in RoleCall |
| --- | --- | --- | --- |
| `shell` / `command` / `raw` / `script` split + `changed_when` / `check_mode` | single `shell` module + `run_mode` | `command`, `raw`, and `script` are aliases of `shell`; explicit idempotency intent | `run_mode: idempotent \| readonly \| always` (see below) |
| `template` / `copy` + Jinja `{{ }}` | `$template` + EJS `<%= %>` | Structured, typed templating over facts/vars | `content: $template: "<%= vars.x %>"` |
| `setup` / `gather_facts` + host vars | `facts gather` + facts in `when`/`loop` | Targeted/cached fact gathering, no implicit magic | `rolecall facts gather <inv>`; `$var: facts.os.family` |
| `ini_file` / `xml` / `lineinfile` for config | `config_edit` | One structured module for INI/TOML/JSON/YAML/XML | `config_edit: { path, format, set: [...] }` |
| `when` / `with_*` / play `vars` | `when` / `loop` / `register` YAML operators | First-class task operators, not module args | `when: $if: ...`, `loop: $each: ...` |

### `run_mode` instead of `shell`/`command`/`raw` + `changed_when`

RoleCall keeps a single `shell` module — `command` and `raw` are thin aliases that forward to it, so there is exactly one execution path. Idempotency intent is explicit:

```yaml
- command:
    cmd: /usr/local/bin/migrate.sh
    run_mode: idempotent        # requires a guard (creates/removes) or throws
    creates: /var/lib/app/migrated
- command:
    cmd: systemctl status app
    run_mode: readonly          # always runs, never reports changed
- command:
    cmd: echo "ran"
    run_mode: always            # always runs and reports changed
```

`command`/`raw` default to `run_mode: always` (Ansible `command` reports changed every
run) unless you set a `creates`/`removes` guard — then they auto-select `run_mode:
idempotent`, so the explicit `run_mode: idempotent` shown above is implied by the
`creates:` guard. You can also set `run_mode` explicitly on `command`/`raw`.

`run_mode: idempotent` (the default) throws if no guard is set, forcing you to make
the task safe to re-run. `readonly` is for checks/`assert`-style probes. `always`
matches Ansible's plain `shell`/`command`.

### `$template` instead of `template` + Jinja

```yaml
- copy:
    dest: /etc/app.conf
    content:
      $template: |
        listen_port = <%= vars.port %>
        host = <%= facts.network.hostname %>
```

## Parity modules (same name, same feature)

These mirror Ansible modules. The `notes:"≠ Ansible …"` line in each module's
reference page lists the deltas. Highlights:

| RoleCall module | Ansible equivalent | Notes |
| --- | --- | --- |
| `package` | `package`/`apt`/`dnf`/`yum` | auto-detects manager (or `manager` override); `src`; `hold` (apt/zypper), `allow_downgrade` (apt), real `cache_valid_time` age check |
| `service` | `service`/`systemd` | systemd-agnostic (SysV fallback); `daemon_reload`, `reloaded`, `pattern`, `scope` (system/user), SysV `runlevel` |
| `cron` | `cron` | marker `#Ansible: <name>`; `backup`, `env`, `insertafter`/`insertbefore`, `cron_file` `mode` |
| `apt_repository` / `yum_repository` | `apt_repository` / `yum_repository` | writes repo file; `apt_repository` `mode`; `yum_repository` cost/priority/exclude/includepkgs/sslcacert/sslverify |
| `authorized_key` / `known_hosts` | `authorized_key` / `known_hosts` | SSH key management |
| `copy` / `fetch` / `slurp` | `copy` / `fetch` / `slurp` | push/pull/read on target; `copy` `force` defaults FALSE (Ansible TRUE) |
| `file` / `stat` / `lineinfile` / `blockinfile` / `replace` | same | idempotent file ops; `lineinfile` regex anchors, `blockinfile` opt-in Ansible markers, `stat` `follow`/`checksum` |
| `assemble` | `assemble` | concatenate remote files; `delimiter` between parts |
| `find` / `tempfile` | `find` / `tempfile` | target-side lookup; `find` `size`/`age`/`contains`/`link` |
| `archive` / `unarchive` | `archive` / `unarchive` | target-side bundling/extraction; `remove`/`exclude_path`/`force_archive`, `keep_newer` |
| `wait_for` | `wait_for` | port/path polling; `search_regex`, `state` started/present/stopped/absent/drained |
| `get_url` / `git` / `user` / `group` | same | downloads, VCS, accounts (incl. `password_hash`) |
| `hostname` / `sysctl` / `modprobe` / `mount` | same | host tuning; `hostname` `use`, `sysctl` `reload`/`sysctl_set`, `mount` `boot`/`dump`/`passno` |
| `selinux` / `iptables` / `ufw` / `timezone` / `locale_gen` / `acl` / `pam_limits` | same | security/limits; `ufw` `default` policy |
| `synchronize` | `synchronize` | rsync **on the target** (not controller→target) |
| `json_query` | `json_query` | JSON-pointer resolve, not JMESPath |
| `service_facts` / `user_info` / `group_info` | same | fact lookups |
| `pause` / `set_stats` / `meta` | same | `pause` has no interactive prompt; `meta` `end_play`/`end_host` halt the play/host, other flags are deferred |
| `parted` / `filesystem` / `lvol` / `lvg` | same | storage/LVM |

## Compatibility notes

- **RoleCall ← Ansible**: copy your Ansible task YAML; rename `shell:`/`command:` to
  `command:` + `run_mode:`, and convert any `{{ }}` to `<%= %>` inside a
  `$template`. Most other modules drop in unchanged.
- **Where RoleCall diverges**: templating is EJS-based by default, but Jinja is available
  on request via `engine: jinja` (e.g. with `copy`) when you need Ansible template
  compatibility or its sandbox; `meta` control flags are not yet wired into the
  executor, `synchronize` runs target-side, and `json_query` uses JSON pointers. Each
  module's reference page states its exact deltas under `notes`.
