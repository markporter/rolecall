# Ansible Compatibility Roadmap — execution plan for ADR 0009

- Status: **Proposed (planning)**
- Date: 2026-10-04
- Parent: [ADR 0009](decisions/0009-ansible-compatibility-and-mechanical-conversion.md)
- Scope: concrete work items that close the (U)/(P)/(X) gaps in ADR 0009 Appendix A.
  (M)apped 1:1 items are done and excluded here.

## Guiding principle (from ADR 0009)

> Conversion **upgrades**, it does not **preserve footguns**. A gap is closed by
> mapping an Ansible idiom to a RoleCall-native form — except where the idiom *is* the
> footgun, in which case we keep the divergence deliberately and document it.

Each item below lists: **gap**, **plan** (files to touch), **effort**
(S/M/L), **tension?** (does closing it erode a RoleCall strength), **decision needed**.

---

## Wave 1 — Structural & inventory parity (low/med effort, no principle conflict)

### P0. Playbook document form — top-level list of plays  *(gap: single-object playbook — RESOLVED)*
- **Status:** **RESOLVED** in the Ansible direction (alpha breaking change). A
  playbook file is now, exactly like Ansible's, a **top-level YAML list of plays**
  (`- name: …` document entries). A **bare single-play object is rejected** at load
  time with a crisp list-required error — `PlaybookSchema = z.array(PlaybookObject)`
  plus a custom bare-object union branch in `src/config/schema.ts`;
  `normalizePlaybook` no longer wraps a lone object.
- **History:** the original RoleCall design accepted *either* a flat top-level task
  list *or* a single play object. That dual document form was a footgun and diverged
  from Ansible, so it is gone. The document form now matches Ansible 1:1; every
  example, fixture, test, and doc was converted to list form and a docs-linter guard
  (`tests/docs-examples.test.ts`) fails on a bare play object.

### P1. Native `roles:` play field  *(gap: play `roles:` — U→M)*
- **Plan:** add `roles?: string[]` to `PlaybookObject` (`src/config/schema.ts`);
  at load time (`src/cli/commands/playbook.ts` / config loader) resolve each name to
  the role's `entry` playbook —    local `roles/<name>` first, then a dependency project per ADR 0014/0015 —
  and splice its tasks, reusing the existing `imports` expansion path.
- **Effort:** M. **Tension:** none. **Decision (D1):** role `defaults` compose at the
  **absolute lowest** precedence — below RoleCall inventory `defaults` **and** play `vars`
  (Ansible `defaults/main.yml` rule). Adds a role-defaults layer beneath RoleCall
   `defaults` (now implemented), and an **ADR 0014/0015 layout refinement**: a role separates `defaults/`
  (lowest), `group_vars/`/`host_vars/` (group/host precedence), and optional `vars/`
  (above play vars), so the precedence model is unambiguous.

### P2. `handlers:` play-level sugar  *(gap: play `handlers:` — U)*
- **Plan:** accept a top-level `handlers:` array on `PlaybookObject` and lower each
  entry to a task carrying `listen:` (the form the executor already supports,
  `src/executor/engine.ts` flush-at-end semantics already match Ansible).
- **Effort:** S. **Tension:** none.
- **Status:** Implemented — `PlaybookObject` accepts `handlers?:` (task-shaped,
  collapsed form supported); `normalizeOnePlay` lowers each entry to a task carrying
  `listen:` defaulting to the handler's `name`, so `notify: <name>` triggers it through
  the executor's existing listen/flush-at-end machinery. Duplicate handler names are
  rejected by a `superRefine` on `PlaybookObject` (path `handlers[].name`). Covered by
  `tests/play-handlers.test.ts`.

### P3. `become_user` / `become_method`  *(gap: task become_user — P)*
- **Plan:** add `become_user?: string`, `become_method?: string` to `TaskSchema`;
  thread into the transport sudo invocation (`src/transport/*`).
- **Effort:** M. **Tension:** none (just richer privilege escalation).

### P4. `gather_facts` — lazy/on-demand targeted gathering  *(gap: play `gather_facts` — P)*
- **Plan (D2):** RoleCall's native model is **lazy, on-demand, targeted + cached** fact
  resolution (already the design intent per `AGENTS.md` "targeted/cached facts";
  closes `ansible-comparison.md` gap #6). A task referencing `facts.<x>` triggers a
  **minimal** fetch of just that fact, cached per host — not Ansible's monolithic
  `setup` pre-gather. Accept `gather_facts?: boolean` in the schema **for Ansible
  compatibility only**: `true` is a harmless hint (facts already resolve on demand);
  `false` opts a play out of any eager pre-gather (default RoleCall behavior is lazy
  regardless). No bulk SSH pre-gather by default.
- **Effort:** M (facts engine gains per-reference targeted fetch + cache; today it
  gathers a set). **Tension:** resolved — lazy gathering is *better* than Ansible
  (only fetches used facts) and keeps RoleCall explicit (no surprise bulk connect).
  **Decision (D2):** lazy/on-demand is the RoleCall-native default; `gather_facts` field
  accepted but effectively a no-op compatibility hint.

### P5. `group_vars/` / `host_vars/` loader  *(gap: dirs — P)*
- **Plan:** `FsProjectSource` (or config loader) reads `group_vars/<group>.yml` and
  `host_vars/<host>.yml` from the project root and feeds
  `ResolveOptions.groupVars` / `hostVars` (`src/inventory/engine.ts`).
- **Effort:** M. **Tension:** none.

### P6. Ansible inventory consumption  *(gap: inventory INI/YAML — U)*
- **Plan:** accept Ansible INI (`[group]`, `[group:children]`, `[group:vars]`) and
  YAML (`all.children` / `vars`) inventories directly through `--inventory` and the
  inventory-consuming commands, auto-detecting the format in the loader and lowering it
  into RoleCall's `groups:` map (reusing `src/inventory/engine.ts` precedence). This
  removes the need to hand-rewrite inventories without a separate conversion step.
- **Effort:** M. **Tension:** none (RoleCall keeps `groups:` as its native form, but no
  longer requires conversion).
- **Status:** Implemented — the originally planned `rolecall inventory import <file>`
  conversion subcommand was replaced by loader-level auto-detection (source-of-truth:
  `src/` wins). `src/inventory/ansible.ts` exposes `parseAnsibleIniInventory` /
  `parseAnsibleYamlInventory`, and `detectInventoryFormat` in `src/config/loader.ts` routes
  a `.ini` extension (or `[`-opening content) to the INI parser, an `all:`-and-no-`groups`
  YAML root to the Ansible YAML parser, and every other root to the strict native schema.
  Both Ansible forms normalize into RoleCall's native inventory (group `children` + a
  document-root `host_vars` map; no flattening, no synthetic single-host groups), so the
  engine resolves group vars with Ansible-style precedence — root-first through `children:`
  so a child group overrides its parent, then `host_vars` above all group vars — while
  inventories without `children`/`host_vars` resolve exactly as before. The `inventory
  import` subcommand, its result type, and its output case were removed entirely (no alias).
  Covered by `tests/inventory-ansible-loader.test.ts`, the `inventory show` CLI smoke tests,
  and INI/YAML fixtures.

---

## Wave 2 — Module parity (biggest real capability gap)

Builtins already present (M): `service`/`systemd`, `lineinfile`, `blockinfile`,
`http`, `sql`, `shell`, `debug`, `assert`, `package`, `file`, `stat`,
`copy` (merged `template` + `config_write` into one surface), `user`, `group`,
`get_url`, `git`, `replace`.

### P7. `package` module  *(apt / yum / dnf / apk — P)*
- **Plan:** new `src/modules/builtins/package.ts`, dispatch by `facts.os_family`,
  idempotent (check installed vs desired). 
- **Effort:** M. **Tension:** none.
- **Status:** Implemented — `package.ts` dispatches by `facts.os_family` (apt/yum/dnf/apk) and is idempotent (installed vs desired `state`).

### P8. `file` module  *(state: directory/touch/link/absent/present — P)*
- **Plan:** new `file.ts` covering the common `state` values; idempotent via diff.
- **Effort:** M. **Tension:** none.
- **Status:** Implemented — `file.ts` covers `state: directory/touch/link/absent/present`, idempotent via diff.

### P9. `template` / `copy` modules  *(P)*
- **Plan:** `template.ts` renders via RoleCall templating (`$template` / structured refs)
  then writes idempotently; `copy.ts` writes a literal file with checksum compare.
  Reuses `config_write` machinery.
- **Effort:** M. **Tension:** none (uses RoleCall's better templating, not Jinja).
- **Status:** Implemented — `copy.ts` now carries the merged surface: literal
  checksum-compare write (`src`/`content`), on-host `eta`/`jinja` rendering via
  `content` (template/template_file), atomic `mv`, `mode`/`owner`/`group`, `backup`, `become`,
  and `--check`. The standalone `template` and `config_write` modules were retired
  into `copy`.

### P10. `user` / `group` modules  *(P)*
- **Plan:** new modules wrapping system commands idempotently. **Effort:** M.
- **Status:** Implemented — `user.ts` (idempotent create/remove/update via system commands) and `group.ts` (idempotent create/remove, GID reconcile via system commands) both implemented.

### P11. `git` module  *(P)*
- **Plan:** new `git.ts` (clone/fetch/checkout, idempotent by ref compare). **Effort:** M.
- **Status:** Implemented — `git.ts` (clone when absent; fetch + checkout/reset by ref compare when present; supports `check`).

### P12. `shell_register` module (closes the changed_when/failed_when probe pattern)  *(new)*
- **Plan:** new `src/modules/builtins/shell_register.ts` — runs a shell command over
  the transport and captures `{ rc, stdout, stderr }` into the `register`ed name
  (reuses RoleCall's `register` mechanism).
  - `changed?: boolean` defaults **`false`** (observation/registration, not a mutation).
  - `capture_errors?: boolean` defaults **`false`** — when `false` (default) a non-zero
    rc is a **failure** (standard); when `true`, a non-zero rc is **captured** (task not
    failed), so probes like `test -f /path` register "not found" instead of erroring.
    Author branches on the registered `rc` via `when`. This obviates Ansible
    `changed_when: false` + `failed_when: false` + `register` with **zero** playbook
    override syntax, and keeps error handling explicit (not silent) by default.
  - `when`/`loop`/`become` apply like any task.
- **Effort:** S. **Tension:** none — capability delivered at the module layer.

### P13. Remaining high-frequency modules  *(P)*
- `get_url`, `unarchive`, `stat`, `replace`, `cron`,
  `apt_repository` / `yum_repository`. Prioritize by Ansible usage frequency; each
  is a small idempotent builtin. **Effort:** M each.
- **Status:** all implemented — `stat` (`stat.ts`), `get_url` (`get_url.ts` — download to host with sha256 verify), `replace` (`replace.ts` — in-file text substitution), `unarchive` (`unarchive.ts`), `cron` (`cron.ts` — `#Ansible: <name>`-marked crontab entries: present/absent/disabled, `special_time`, user crontab or `/etc/cron.d` drop-in), `apt_repository` (`apt_repository.ts` — `sources.list.d` line management, `validate_certs`/`update_cache`), and `yum_repository` (`yum_repository.ts` — `/etc/yum.repos.d` INI section management). Each is `resource()`-backed (describe/converge, `check` dry-run) over the SSH/local transport.

---

## Wave 3 — Control-flow parity (resolve the tensions)

### P13. `tags` + `--tags` / `--skip-tags`  *(gap: play/task `tags:` — X)*
- **Plan:** `tags?: string[]` on tasks/plays; global flags `--tags` / `--skip-tags`
  filter the resolved task list before run. **Effort:** M. **Tension:** none
  (selection mechanism, not a footgun).
- **Status:** Implemented — `tags?: string[]` accepted on tasks and plays (a task's own
  tags replace its play's — no union). Global `--tags` / `--skip-tags` (comma-separated,
  whitespace-trimmed; a present-but-empty value is a usage error, exit 2) filter the
  fully-expanded task list (roles + `include_tasks`) before execution, and a skipped task
  reports reason `tag-filtered`. Handlers are exempt from `--tags` inclusion and are
  excluded by `--skip-tags` only when they explicitly declare a skipped tag.

### P14. `ignore_errors`  *(gap — X)*  **TENSION**
- **Plan A (add):** `ignore_errors?: boolean` (default false) honoring Ansible
  semantics — a failed task marks changed-but-continues instead of halting the host.
- **Plan B (keep divergence):** do not add; the converter maps `ignore_errors: yes`
  to a `tx`/`checkpoint` guard + documents RunTrace as the better failure-locality
  story.
- **Effort:** S. **Tension:** HIGH — silent `ignore_errors: yes` is exactly the
  "hard to debug / stuck runs" complaint RoleCall's RunTrace answers. **Decision needed.**

### P15. `changed_when` / `failed_when`  *(gap — X)*  **TENSION — RESOLVED via modules**
- **Decision:** keep these as **deliberate divergence** (no playbook override
  syntax). The underlying need is met at the **module layer** instead:
  - Read-only / output-capturing commands (the dominant `changed_when: false` +
    `register` + `failed_when: false` probe pattern) → new **`shell_register`**
    module (P12): runs a command, captures rc/stdout/stderr, reports `changed: false`,
    and does **not** fail on non-zero rc (observation semantics). No override needed.
  - Genuinely dynamic change/failure detection → **`shell`** (existing) or a
    proper idempotent module implementing `describe`/`converge`. The expression form
    is a smell that *should* be a module.
- **Effort:** — (divergence) + S (`shell_register` module). **Tension:** resolved —
  capability preserved without importing the templating/override footgun.

### P16. `block` / `rescue` / `always`  *(gap — P)*  **TENSION**
- **Plan:** `block`/`rescue` → `tx` + `checkpoint` (rollback on failure). `always`
  (run-regardless cleanup) has no RoleCall equivalent — propose a `always:` task group
  that runs even on upstream failure. **Effort:** L. **Tension:** partial — `always`
  reintroduces unconditional-run semantics; scope it narrowly. **Decision needed.**

### P17. `connection:` task field  *(gap — P)*
- **Plan:** optional `connection?: string` mapping to transport selection
  (`src/transport/*`). **Effort:** S–M. **Tension:** none.

### P18. `extra_vars` (`-e`)  *(gap — X → resolved/implemented)*
- **Plan:** global flag `--extra-vars` / `-e` merged at the **highest** precedence
  layer. **Effort:** S. **Tension:** none (just vars).
- **Status:** Implemented — `--extra-vars` / `-e` is the top precedence layer; `rolecall vars trace <name>` surfaces its override of any lower layer.

### P19. `ansible_*` facts name parity  *(gap — U)*
- **Plan:** facts engine (`src/facts/*`) exposes Ansible-named facts
  (`ansible_os_family`, `ansible_distribution`, …) and aliases
  `inventory_hostname` → `host` so unconverted `{{ }}`-free references resolve.
- **Effort:** M. **Tension:** none (additive aliases).

---

## Deliberate divergences to KEEP (protects "what makes RoleCall better")

| Ansible construct | Why we keep the divergence | Converter behavior |
|---|---|---|
| `changed_when` / `failed_when` | Intrinsic idempotency is a RoleCall differentiator; expression form is a smell | divergence; need met by `shell_register` (P12) + `shell`; converter → `REVIEW.md` note to use them |
| Implicit `{{ }}` rendering | ADR 0008 `strict` default; no YAML/Jinja escaping hell | translate to `$var`/`$template` |
| `ignore_errors` (silent continue) | Conflicts with RunTrace failure-locality | divergence; converter maps to `tx`/`checkpoint` guard + `REVIEW.md` note |
| `block`/`rescue`/`always` (`always`) | No RoleCall analog; unconditional-run semantics | `block`/`rescue`→`tx`/`checkpoint`; `always`→divergence; converter suggests final idempotent cleanup task |
| `gather_facts` default `true` | RoleCall is explicit by default | converter sets `true` |

## Recommended sequencing

1. **Wave 1** first — highest leverage, lowest risk, no principle conflict. Unblocks
   the majority of role/inventory conversions.
2. **Wave 2** in parallel — module parity is the largest *capability* gap; without
   `package`/`file`/`copy`/`template`/`user` most real playbooks cannot run.
3. **Wave 3** last — resolve the three tensions (P14, P15, P16) with explicit
   decisions before building, since they touch RoleCall's core differentiators.

## Open decisions for the owner

- **D1 (P1):** ~~role `defaults` precedence?~~ **RESOLVED** — role `defaults` compose at the **absolute lowest** precedence (below RoleCall inventory `defaults` + play `vars`); needs new role-defaults layer + ADR 0014/0015 layout refinement.
- **D2 (P4):** ~~`gather_facts` default?~~ **RESOLVED** — RoleCall-native = **lazy/on-demand targeted gathering** (per-reference fetch + cache, no bulk pre-gather). `gather_facts?: boolean` accepted for Ansible compat as a no-op hint (`true` harmless, `false` opts out of eager). Supplants the false/true binary.
- **D3 (P14):** ~~add `ignore_errors`?~~ **RESOLVED** — keep divergence; converter maps to `tx` guard.
- **D4 (P15):** ~~confirm changed_when/failed_when unsupported?~~ **RESOLVED** — divergence; need met by `shell_register` (P12) + `shell`.
- **D5 (P16):** ~~approve `always:` group?~~ **RESOLVED** — `block`/`rescue`→`tx`/`checkpoint`; `always` divergence.
- **D6 (P12):** ~~shell_register semantics?~~ **RESOLVED** — `changed?: false` default; `capture_errors?: boolean` default `false` (non-zero rc FAILS by default; `true` captures rc without failing). Captures `{rc,stdout,stderr}` into `register`. Explicit, not silent.
