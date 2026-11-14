# Ansible Splunk remediation plan

- Status: **Approved (build)**
- Date: 2026-11-14
- Source analysis: `.local/ansible_splunk_gaps.md`
- Related: ADR 0009 (Ansible compatibility), ADR 0024 (analyzer/converter/handoff), ADR 0031 (opt-in Eta template conversion), ADR 0008 (literal-by-default templating), ADR 0013 (namespaced refs), ADR 0025 (isolation)
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
7. **Template files stay Jinja by default.** ADR 0031 adds an opt-in
   `--templates eta` tier that mechanically converts the safely translatable
   subset of a `.j2`/inline Jinja template to Eta, per whole file. The default
   `--templates keep` preserves `engine: jinja` and verbatim `.j2` output; playbook
   scalars remain structured refs or `$jinja` and are never rewritten to Eta.

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
- Template *files* are the ADR 0031 surface: `.j2` assets referenced by a
  converted `template`/`copy` task remain Jinja by default, and `--templates eta`
  may convert a whole file to `.eta` (never a mixed file). Inline playbook
  `$jinja` is not part of that pass.

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
   - `with_items` / `loop` / `with_dict` / `with_together` / `with_nested` →
     `$each` (with `dict2items`/`zip`/`product` where needed).
   - unconditional `include_role` → `roles:`; conditional → `include_tasks` or handoff.
   - static `include_vars` → ordered `vars_files`; dynamic → handoff.
   - static `import_playbook` → inlined plays.
   - static `with_first_found` on `copy`/`template` → ordered `src`/
     `template_file` candidates.
   - `ignore_errors` / `failed_when` → handoff (no faithful RoleCall equivalent).
   - shell `changed_when: false|true` → `run_mode: readonly|always`; other
     `changed_when` uses are handoff.
   - `block` / `rescue` → `tx`/`checkpoint` + REVIEW; `always` → handoff.
   - play-level `become`/`connection`/`when`/`run_once` → task-level rewrite;
     `remote_user` is handoff. `order` is preserved natively.
   - task `vars`, `loop_control`, `delegate_facts`, `check_mode`, `async`, `until`,
     `retries`, `delay` → handoff. Percentage `serial` is native.
   - `lookup`/`query`/`q` → handoff (controller-side I/O is outside the bounded
     template surface).
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

## Conversion workflow

The end-to-end path is:

```sh
rolecall convert                                  # TTY wizard
rolecall convert ansible ./ansible-source --project ./new-project --write
rolecall convert ansible --validate ./new-project/playbooks
```

The bare command prompts for the source path, target project directory, write/handoff
choices, strict mode, and a final apply confirmation; `--yes`/`--non-interactive`/
`--dry-run` skip the wizard.

`--project <dir>` creates the documented ADR 0014/0030 blank-project shape if it
does not exist (and only fills in missing files when it does), then writes the
converted playbooks, roles, `group_vars`/`host_vars`, and assets into it. The
default `--out` is the project root; an explicit `--out` still wins. This makes
the converter the first step of a real migration rather than a detached tree.

## Cycle 4 — Corpus conversion and iteration

- Run the converter against `/home/mark/local_code/ansible_splunk`.
- Track parsed files, mechanical rewrites, REVIEW items, handoffs, validation
  failures.
- Fix the highest-frequency handoff classes first.
- Add an opt-in corpus harness (`ROLECALL_ANSIBLE_CORPUS=...`).

## Cycle 5 — ADR 0031 opt-in Eta template conversion

ADR 0031 amends ADR 0024's "never eta" policy with an explicit, default-off
template tier. The converter still emits `engine: jinja` and verbatim `.j2` files
by default; this cycle is additive and must not widen the default trust posture.

### CLI and scope

```sh
rolecall convert ansible <path> --templates keep   # default: preserve Jinja/.j2
rolecall convert ansible <path> --templates eta    # attempt whole-file Eta output
```

- The template pass targets only template surfaces: `.j2` files referenced by a
  converted `template` task or a `copy` content spec with `engine: jinja`, and
  inline `copy.content.template` strings already carrying `engine: jinja`.
- Playbook scalar Jinja is out of scope; it remains structured refs or `$jinja`.
- Conversion is committed per whole file. A file with any non-convertible
  construct stays Jinja; no half-converted template is emitted.
- `--templates eta` still obeys `--write`/`--strict`; dry-run reports what would
  convert, and strict mode fails on review/handoff template items.

### Classification and output

Parse with the Nunjucks AST and classify every node:

- **mapped** — output expressions, `if`/`elif`/`else`, `for` (with `loop.*`
  metadata), `set`, comments, simple attribute/index access, `raw`, and
  filters/tests with verified JS equivalents.
- **review** — edge-case fidelity: attribute `map`/`select`/`reject`,
  `namespace`, cross-scope mutation, `default(omit)`, truthiness-sensitive
  comparisons, whitespace trim markers, and tests whose undefined behavior differs.
- **handoff** — macros, `call`, `import`/`from`, `include`, `extends`, `block`,
  `filter` blocks, lookups/`query`/`q`, Python-only methods, unknown
  filters/tests, and unresolved dynamic constructs.

For a fully converted file: write `<name>.eta`, rewrite the task to
`content: { template_file: <name>.eta, engine: eta }`, omit the original `.j2`
from the converted tree, and record the source→output mapping in `manifest.json`.

For a file with unresolved constructs: keep the original `.j2` and
`engine: jinja`; emit a handoff work order plus a complete partial Eta draft at
`handoff/templates/<id>.eta.draft` with `/* HANDOFF: <construct> @ <line> */`
markers. Each work order includes the original snippet/location, per-construct
disposition, the draft, runtime helper mappings, and a render-equivalence fixture
or an explicit statement that none is possible.

### Runtime parity (prerequisite)

Before code generation ships, Eta's render context must match Jinja for the
supported subset:

- expose `ANSIBLE_FILTERS`, `ANSIBLE_TESTS`, and the relevant `ANSIBLE_GLOBALS`
  (`omit`, `now`) to Eta, or generate calls against the same callables;
- provide loop metadata (`loop.index`, `index0`, `first`, `last`, `length`,
  `revindex`, `cycle`) including nested-loop shadowing;
- define undefined/truthiness behavior so converted templates do not silently
  change from strict Nunjucks to lenient Eta rendering;
- keep `autoEscape: false` and literal whitespace parity; trim markers remain
  review-only until verified.

### Security and validation

- Conversion parses and rewrites; it never executes a template.
- Eta output is restricted code: converted `engine: eta` templates require the
  ADR 0025 approval/sandbox path exactly like hand-written Eta and are never run
  under `--isolation none` without the existing unsafe escape hatch.
- `--templates eta` must not add executable template surface without the flag.
- `--validate <dir>` checks that every converted template reference resolves,
  `engine` matches the file extension, and no file is half-converted.
- Add golden fixtures that render original Jinja and converted Eta with the same
  defined vars and byte-compare output. `review` constructs need an explicit
  expected-output fixture before promotion to `mapped`.
- The analyzer stays offline and deterministic: identical source hashes produce
  identical classification, draft bytes, and manifest ordering.

### Implementation slices

1. **Analyzer only** — AST parse, classification, `manifest.json` and work-order
   emission; no rewritten templates.
2. **Runtime parity** — shared Ansible filters/tests/globals and loop metadata in
   the Eta context, with parity tests for defined-value cases.
3. **Mapped codegen** — output, `if`, `for` + loop metadata, `set`, comments, and
   simple filters; golden render-equivalence tests.
4. **CLI and docs** — `--templates eta`, output mapping, strict-mode behavior,
   and updates to ADR 0024, `AGENTS.md`, `README.md`, `design/`, and
   `docs/content/concepts/templates.md`.

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
- **Cycle 2: complete.** Landed `$jinja`, `$exists`, `$length`, indexed `$var`
  paths, strict-by-default Jinja, bare-`when` rejection, the no-Jinja-in-playbook
  lint (only `$jinja` is exempt), and the ADR 0024 MVP (`rolecall convert ansible`
  with analyzer/rewriter/`HANDOFF.md`/`manifest.json`, `--write`, `--strict`, and
  `--validate`), plus lazy structured-variable resolution (derived `vars` containing
  `$jinja`/`$concat`/`$var`).
- **Cycle 3: complete for the current converter surface.** Added `$exists`/`$length`/indexed paths, the `omit`
  sentinel, Ansible magic-fact gatherers (`system`, `default_ipv4`, `dns`,
  `date_time`), `run.playbook_dir`, filter/test parity (`zip`, `product`, `ipaddr`,
  `strftime`, `human_readable`, `password_hash`, `iterable`, `mapping`, result-state
  tests), native role `meta` dependencies, percentage `serial`, and shell
  `changed_when` -> `run_mode`. Converter mappings now cover `with_dict`,
  `with_together`/`with_nested`, static `include_vars`, static `import_playbook`
  inlining, `with_first_found` -> `copy` candidates, `group_vars`/`host_vars` and role `defaults`/`vars` Jinja, and
  `hostvars[...]`/`groups[...]` bracket access. The typed compatibility matrix lives
  in `src/convert/matrix.ts`. Remaining handoffs are the non-mechanical/by-design
  classes: dynamic includes/`include_role`, `with_first_found` on
  non-copy/template tasks, `ignore_errors`/`failed_when`, `async`/`until`/`retries`,
  play-level `remote_user`, `lookup`/`query`, and crypt-compatible `password_hash`.
- **Conversion workflow:** `convert ansible --project <dir>` now scaffolds the blank
  ADR 0014/0030 project shape and populates it with the converted tree (tested with a
  representative playbook/role/group_vars sample). `rolecall project create|init` now
  exposes the same scaffold directly, with `--force` and optional `--vcs git`.
- **Cycle 4 (corpus run):** converted `/mnt/homes/mark/ANM/anm_dev/ansible_splunk`
  (1,819 files) with `--templates eta`; the current pass yields 8,308 mapped,
  187 review, and 948 handoff findings, and validates 128 converted playbooks with
  **0 failures**. A checked-in golden fixture (`tests/fixtures/ansible-golden`) keeps
  the pipeline covered in CI. Remaining findings are the documented handoff classes
  (`ignore_errors`, `async`/`until`/`retries`, dynamic includes/roles, etc.).
- **Cycle 5 (ADR 0031, slices 1–3 partial):** `--templates eta` parses each `.j2`
  with the Nunjucks AST, classifies constructs as mapped/review/handoff, and emits
  per-item handoff work orders. Fully mapped templates are written as `.eta` and
  their task references are rewritten to `engine: eta`; review/handoff templates
  keep the original `.j2` and `engine: jinja`. The Eta runtime exposes shared
  `filters`/`tests`/`globals` views (including `omit`) and unwraps lenient missing
  values for Ansible filters/tests. Partial Eta drafts with HANDOFF markers are emitted for
  review/handoff templates. Review constructs can be explicitly accepted with
  `--templates-review accept`. Loop metadata now includes `cycle`, `previtem`, and `nextitem`; Nunjucks
  applies whitespace trim markers before codegen, so trimmed output is preserved.
  `--validate` now checks template references, engine/extension pairing, and
  half-converted files. Ansible YAML/INI inventory connection vars are rewritten to
  `rolecall_*` during conversion. A checked-in golden fixture covers the full
  pipeline. Remaining: the external corpus run. The default `--templates keep` path is unchanged.

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
- ADR 0031 conversion changes an inert `.j2` into executable Eta. It must stay
  default-off, whole-file, and behind the ADR 0025 approval/sandbox path; a
  half-converted file or a silent undefined/truthiness change is worse than
  leaving the template as Jinja.
