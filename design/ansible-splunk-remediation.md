# Ansible Splunk remediation plan

- Status: **Approved (build)**
- Date: 2026-11-14
- Source analysis: `.local/ansible_splunk_gaps.md`
- Related: ADR 0009 (Ansible compatibility), ADR 0024 (analyzer/converter/handoff), ADR 0008 (literal-by-default templating), ADR 0013 (namespaced refs), ADR 0025 (isolation)
- Scope: close the gaps between `ansible_splunk` and RoleCall by **converting to RoleCall idioms**, not by emulating Ansible in the executor.

## Decisions

1. **Strict defaults.** Ansible-only constructs do not become new executor features.
   A construct is either mechanically converted to a RoleCall idiom or emitted as a
   handoff item.
2. **No Ansible compatibility mode.** There is no `ansible_compat` switch and no
   `ansible_*` alias surface. Converted projects use RoleCall namespaces.
3. **`block` / `rescue` / `always`** → `tx` / `checkpoint` during conversion;
   `always` is a handoff item. No native block node is added.
4. **Strict Jinja by default.** Undefined names throw.
5. **No Jinja in playbook YAML.** `{{ }}`, `{% %}`, and `{# #}` are load-time errors
   everywhere in playbook scalars. The only Jinja escape hatch is the explicit
   `$jinja` node. `$template` remains the Eta (EJS) node and has no engine option.
   External `.j2` assets remain valid because the Jinja lives in the file, not the
   playbook.
6. **Module parity first**, then the ADR 0024 converter, then conversion
   primitives, then corpus iteration.

## Templating rule

- Allowed in playbook YAML: structured refs (`$var`, `$concat`, `$if`, `$call`,
  `$each`, `$template`, `$jinja`) and plain literal values.
- Forbidden in playbook YAML: raw `{{ }}`, `{% %}`, `{# #}` in any scalar
  (args, `when`, `loop`, `vars`, `notify`, names, `environment`, template paths).
- `$template` = Eta escape hatch (restricted code; approval-gated).
- `$jinja` = new explicit Jinja node (strict Nunjucks; bounded language).
- `copy` `content.template_file` may point at a `.j2` file. Inline
  `content.template` may not contain Jinja; use `$jinja` or a `.j2` file.
- The lint exemption applies to `$jinja` payloads only. The old
  `copy.args.content.template` Jinja exemption is removed.

## Cycle 1 — Module parity (first)

Make the RC module surface expressive enough for mechanical conversion. The
converter owns name remapping; no runtime aliases are added for `apt`/`yum`/
`template`/`systemd`.

Name remaps:

| Ansible | RoleCall |
|---|---|
| `template` | `copy` + `content: { template_file, engine: jinja }` |
| `apt` / `yum` / `dnf` | `package` |
| `systemd` | `service` |
| `setup` / `gather_facts` | remove (facts are lazy) |

Argument parity, highest corpus counts first:

| Module | Work |
|---|---|
| `copy` | directory `src`, `remote_src`; keep template/backup/mode/owner/group |
| `lineinfile` | `create`, `dest` alias, `owner`/`group`/`mode`; audit `insert*`/backup/validate |
| `config_edit` (`ini_file`) | `section`/`option`, `create`, `mode`/`owner`/`group`, `backup` |
| `find` | `patterns` plural alias; audit `hidden`/`age`/`file_type` |
| `debug` | `var`, `verbosity` |
| `assert` | `fail_msg`, `success_msg` |
| `unarchive` | `owner`/`group`, `remote_src` (on-target always) |
| `user` | `generate_ssh_key`, `comment`, `update_password` |
| `blockinfile` | `insertbefore` |
| `pause` | non-interactive; `prompt`/`echo` are converter handoffs/no-ops |
| `synchronize` | `rsync_path`, `archive`, `use_ssh_args`, `checksum` mapping |
| `pam_limits` | accept `limit_type`/`limit_item` names or converter rewrite |
| `file` | `dest` alias; audit `recurse` |

New modules: `wait_for_connection`, `pamd`, `apt_key`, `debconf`.

Exit criteria: each target module has a schema, check mode where sensible,
block-style YAML examples, and tests. Both runtime branches and `bun run build`
pass. Docs and examples stay in sync.

## Cycle 2 — ADR 0024 converter MVP + strictness

```sh
rolecall convert ansible <path> [--out <dir>] [--handoff <dir>] [--write] [--strict] [--report json|md]
rolecall convert ansible --validate <dir>
```

Deliverables:

1. Typed compatibility matrix (single source for analyzer, rewriter, handoff, docs).
2. Analyzer over YAML, templates, and Jinja expressions.
3. Rewriter for mechanical items:
   - `when` → `$eq`/`$ne`/`$in`/`$and`/`$not`/`$exists`/`$jinja`.
   - derived `vars` → `$var`/`$concat`/`$if` or materialized literals.
   - `groups` → `inv.groups`; `hostvars` → `inv.hosts`; `inventory_hostname` →
     `play.host`; `playbook_dir` → `run.playbook_dir`; `role_path` → `role.path`.
   - `ansible_*` → `facts.*` where a gatherer exists, else handoff.
   - `with_items` / `loop` → `$each`.
   - unconditional `include_role` → `roles:`; conditional → `include_tasks` or handoff.
   - static `include_vars` → ordered `vars_files`; dynamic → handoff.
   - static `import_playbook` → top-level plays.
   - `ignore_errors` → `tx`/`checkpoint` + REVIEW.
   - `changed_when` / `failed_when` → `shell_register` or idempotent module + REVIEW.
   - `block` / `rescue` → `tx`/`checkpoint` + REVIEW; `always` → handoff.
   - play-level `become`/`connection`/`remote_user`/`when`/`run_once` → task-level
     rewrite or handoff.
   - task `vars`, `loop_control`, `delegate_facts`, `check_mode`, `async`, `until`,
     `retries`, `delay`, `serial: "30%"` → handoff.
   - `lookup('file')` → VFS helper/handoff; `lookup('password')` → secrets/handoff;
     `lookup('pipe')` → handoff by default.
4. Handoff bundle: versioned `REVIEW.md` + machine-readable items with file/line,
   construct, reason, and suggested RC idiom.
5. Validation: schema + strict Jinja render dry-run, rejecting empty/unresolved output.
6. Strictness hardening:
   - `renderJinja` defaults to `strict: true`; `copy` stops passing `strict: false`.
   - `lintTemplateRefs` rejects bare non-boolean `when` strings and lists become
     implicit `$and`.
   - Jinja delimiters are hard errors in playbook scalars; only `$jinja` payloads
     are exempt.
   - `$jinja` joins `REFERENCE_OPS`; `when` accepts it and coerces only its resolved
     boolean.
   - Update docs/examples/fixtures and add a migration section.

## Cycle 3 — Conversion primitives

Only RC-native primitives that reduce handoff count:

- `$exists` (unblocks `is defined` / `is not defined`).
- `$length` and indexed `$var` paths (`vars.x[0]`).
- `$omit` sentinel or `$if` mapping for `omit`.
- Structured `vars` resolution with cycle detection; audit cross-tier deep merge
  (`vars_files` already deep-merges; `default_vars.yml` vs `deployment_vars.yml`
  may be a cross-tier gap, not a file-merge gap).
- Dynamic host lookup (`hostvars[item]`) via `$jinja` or indexed `$var`.
- RC context additions: `run.playbook_dir`, `play.path`.
- Missing facts needed by converted templates: `pkg_mgr`, `date_time`, `dns`,
  `default_ipv4`.
- Missing filters/tests: `ipaddr`, `strftime`, `password_hash`,
  `human_readable`; `iterable`, `mapping`, `succeeded`, `failed`, `changed`,
  `running`.

Explicitly not doing: `ansible_*` aliases, `groups`/`hostvars` globals, native
block/rescue/always, `ignore_errors`/`changed_when`/`failed_when` fields,
`async`/`until`/`retries`/`delay`, multi-inventory runtime support, Ansible
callback plugins.

## Cycle 4 — Corpus conversion and iteration

- Run the converter against `/home/mark/local_code/ansible_splunk`.
- Track parsed files, mechanical rewrites, REVIEW items, handoffs, validation
  failures.
- Fix the highest-frequency handoff classes first.
- Add an opt-in corpus harness (`ROLECALL_ANSIBLE_CORPUS=...`).

## Verification

```sh
bun test
ROLECALL_RUNTIME=bun bun test
ROLECALL_RUNTIME=node bun test
bun run build
```

Plus golden converter tests per construct, “load must fail” tests for strict
`when`/Jinja, and four-surface documentation sync.

## Progress

- **Cycle 1 (module parity): complete.** Landed module-name remap targets and argument
  parity for `copy` (directory contents + `remote_src`), `lineinfile`
  (`create`/`dest`/attributes), `config_edit` (`section`/`option`, `create`, backup,
  attributes), `find` (`patterns`), `debug` (`var`/`verbosity`), `assert`
  (`fail_msg`/`success_msg`), `unarchive` (`owner`/`group`/`remote_src`), `user`
  (`comment`/`generate_ssh_key`/`update_password`), `blockinfile` (`insertbefore`),
  `synchronize` (`rsync_path`/`archive`/`use_ssh_args`/`checksum`), `file` (`dest`),
  and `pam_limits` (`limit_type`/`limit_item`). Added `wait_for_connection`, `pamd`,
  `apt_key`, and `debconf`. Tests, both runtime branches, the type gate, generated
  module reference, API docs, and the VitePress build are green.
- **Cycle 2 (in progress):** landed `$jinja`, `$exists`, `$length`, indexed `$var`
  paths, strict-by-default Jinja, bare-`when` rejection, the no-Jinja-in-playbook
  lint (only `$jinja` is exempt), and the ADR 0024 MVP (`rolecall convert ansible`
  with analyzer/rewriter/`HANDOFF.md`/`manifest.json`, `--write`, `--strict`, and
  `--validate`), plus lazy structured-variable resolution (derived `vars` containing
  `$jinja`/`$concat`/`$var`).
- **Cycle 3 (in progress):** added `$exists`/`$length`/indexed paths, `omit` sentinel
  handling, Ansible magic-fact gatherers (`system`, `default_ipv4`, `dns`,
  `date_time`), `run.playbook_dir`, filter/test parity (`ipaddr`, `strftime`,
  `human_readable`, `password_hash`, `iterable`, `mapping`, result-state tests), and
  converter mappings for `with_dict` and static `include_vars`. Remaining Cycle 3:
  dynamic host lookup, role/asset-tree fidelity, and the typed compatibility matrix.

## Risks

- Strict Jinja is a breaking alpha change; it will surface every undefined name.
  That is intentional, but needs migration docs and converter-inserted
  `| default(...)` / `$if`.
- `tx`/`checkpoint` is not a perfect `block`/`rescue` replacement; REVIEW notes
  must say so, especially for `always`.
- The source report’s precedence claim appears inaccurate (Ansible has play vars
  above `host_vars`); verify against Ansible docs before changing precedence.
  The actionable divergence is `vars_files`/role-vars tier ordering.
- Module parity is large; prioritize by corpus count and let the handoff report
  drive the remainder.
