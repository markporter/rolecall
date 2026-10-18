# 0009 — Ansible Compatibility Surface & Mechanical Conversion

- Status: **Proposed**
- Date: 2026-10-04
- Supersedes: none
- Related:
  - [ADR 0014](0014-project-and-plugin-architecture.md) (folder-projects, role-as-project model) + [ADR 0015](0015-collections-and-install-commands.md) (RoleCall-native distribution; replaced retired ADR 0007)
  - [ADR 0008](0008-literal-by-default-templating-and-template-operator.md) (literal-by-default templating; `$template` opt-in)
  - [ADR 0003](0003-zod-driven-agent-surface.md) (Zod-derived validation/agent surface)
  - `goals.md` §"Ansible-inspired design (complaint-driven)"
  - `ansible-comparison.md` / `ansible-challenges-summary.md`
  - [`ansible-compatibility-roadmap.md`](../ansible-compatibility-roadmap.md) (execution plan for this ADR; every open decision D1–D6 resolved)

## Context

RoleCall is explicitly "a better Ansible" (`goals.md` Mission). The single largest
adoption barrier is not features — it is the **existing Ansible corpus**: a vast
body of playbooks and roles an operator would have to rewrite by hand. Conversion
friction, not capability, decides whether an Ansible user tries RoleCall.

The directive this ADR captures:

1. RoleCall should be **close enough** to Ansible in *playbook format and capabilities*
   that converting Ansible playbooks/roles to RoleCall is **mechanical**, not a rewrite.
2. This must be achieved **without compromising what makes RoleCall better** (fast
   escapeless templating, JS/TS modules, intrinsic idempotency, typed control
   flow, RunTrace, tx/checkpoint, clientless agent surface).
3. We commit to shipping a **migration guide** and an **LLM-assisted conversion
   script**.
4. We adopt a standing mandate to **weigh Ansible compatibility in future design
   decisions**.

### What the code already supports (grounded in `src/`)

The playbook surface already mirrors much of Ansible's shape
(`src/config/schema.ts`): `hosts`, `tasks`, `vars`, `when`, `loop`, `notify`,
`register`, `delegate_to`, `run_once`, `serial`, `strategy`, `become`, and
`tx`/`checkpoint`. The executor (`src/executor/engine.ts`) implements `when`
guards, `loop` expansion, `notify`/`listen` handlers, `register`, `run_once`,
`delegate_to`, `serial` batching, and `strategy: free`.

But the schema is **`strictObject`** and deliberately **rejects** Ansible-idiomatic
keys: `roles:`, `tags:`, the top-level `handlers:` block, `gather_facts`,
`ignore_errors`, `connection:`, `become_user`/`become_method`, and
`block`/`rescue`/`always` (`schema.ts:138` notes unknown keys incl. `roles:` are
  rejected). Templating (`src/templating/refs.ts`, ADR 0008): bare strings are
  **always** literal (there is no `legacy` mode) and only `$template` opts into
  **eta**/EJS rendering via `<%= %>` delimiters — so an Ansible `{{ var }}` is
  **not** rendered and stays literal. RoleCall's native, escapeless
path is structured refs (`$var`/`$concat`/`$call`/`$if`/`$each`) plus typed
predicates (`$eq`, `$and`, …). The module set (`src/modules/builtins/index.ts`) is
small (service, shell, http, config_edit, blockinfile, lineinfile, sql,
copy, debug, assert). Inventory (`src/inventory/engine.ts`)
has group/host vars, `:children` recursion, globs, and a 4-layer precedence
(`host > group > group_all > defaults`) — close to Ansible.

## Decision

### 1. Ansible-compatibility is a standing design constraint

Any new playbook field, module, inventory construct, or executor control-flow
feature MUST be evaluated for (a) its Ansible equivalent and (b) the conversion
cost it imposes on existing Ansible content, **before adoption**. The mapping — or
the deliberate divergence plus its rationale — is recorded in the compatibility
matrix (Appendix A, promoted into the migration guide). This is the concrete form
of "consider compatibility when making design decisions."

### 2. Conversion upgrades, it does not preserve footguns

Where RoleCall is strictly better, the converter and guide translate Ansible idioms to
**RoleCall-native forms** rather than re-create Ansible's sharp edges:

- **Jinja `when:`** → typed predicate node (`{ $eq: [ { $var: x }, "v" ] }`), or
   as a faithful fallback a `$template` eta string. Prefer structured
  predicates (type-checked, escapeless).
- **`{{ var }}` / `{{ var | filter }}`** → `{ $var: var }` / `{ $concat: [...] }`
  / `{ $call: filter, args: [...] }` when the filter is registered; else
  `{ $template: "<%= var %>" }` (note the **eta** delimiter, *not* `{{ }}`).
- **Idempotent-by-convention modules** → RoleCall intrinsic-idempotency modules (no
  `changed_when` needed).
- **`block`/`rescue`/`always`** → documented as manual, but prefer `tx` +
  `checkpoint` (todo 26) where the intent is "roll back on failure".

RoleCall core **never** adopts silent `{{ }}` rendering; bare strings stay literal and
only `$template` opts into EJS (ADR 0008). Compatibility is achieved by
**translation**, not by importing Ansible's templating hazards.

### 3. Support `roles:` as a native play field

Today `PlaybookSchema` is `strictObject` and rejects `roles:`
(`schema.ts:138`). To make role-centric Ansible playbooks convert with minimal
change, add a play-level `roles:` list that composes each named role's `entry`
playbook at load time, reusing ADR 0014/0015's role-as-project model (roles are full RoleCall projects;
local `roles/` shadows unscoped npm). This removes the single biggest structural
gap and reuses the existing `imports`/role-composition machinery.

### 4. The strict Zod schema is a compatibility feature

Unknown Ansible keys (`tags:`, `handlers:`, `gather_facts:`, `ignore_errors:`,
`connection:`) **fail closed** with an actionable error instead of silently
misbehaving. The converter relies on this: it emits strict-`PlaybookSchema`-valid
RoleCall, and any unconvertible construct is routed to a human-review report rather than
dropped. (Ties to ADR 0003 — the schema is the source of truth.)

### 5. Deliverable: migration guide

`docs/content/guide/migrating-from-ansible.md` — example-driven manual conversion
steps plus a **gotchas** section:

- the `{{ }}` → eta/`$var` trap (most common silent break),
- `roles:` → native role composition (decision #3) or `imports`,
- `handlers:` block → `listen:` tasks + `notify`,
- `gather_facts: true` → explicit `rolecall facts gather` / facts availability (no
  implicit auto-gather),
- `become_user`/`become_method` loss (only `become: true` → sudo today),
- `ignore_errors` / `changed_when` / `failed_when` loss (intrinsic idempotency),
- `tags` / `--tags` / `--skip-tags` absence (by design),
- `block`/`rescue`/`always` → `tx`/`checkpoint`,
- module-name remap table (Ansible module → RoleCall module / "gap"),
- inventory format (`groups:` map vs INI/YAML), `group_vars/`/`host_vars/` status,
- `extra_vars` (`-e`) absence; `ansible_*` magic vars → `facts.*`, `inventory_hostname` → `host` alias.

Status: **planned deliverable.**

### 6. Deliverable: LLM-assisted conversion tool

`rolecall convert ansible <path>` (preferred — discoverable + `/mcp` parity) or
`scripts/convert-ansible.ts`. **Vendor-neutral**: it builds a prompt from the
compatibility matrix + worked examples, calls the *user-supplied* LLM, and emits
strict-`PlaybookSchema`-validated RoleCall YAML. Unconvertible constructs become
comments plus a `REVIEW.md` carrying the original snippet. Because output is
validated against the live Zod schema, the tool self-corrects on unknown keys
(ADR 0003). No embedded LLM provider — the harness stays outside RoleCall
(`ansible-comparison.md` §10).

Status: **planned deliverable.**

### 7. Maintain a living compatibility matrix

Appendix A below is the single source of truth, classified per construct as:
**(M)** mapped 1:1 · **(U)** mapped-with-upgrade · **(P)** partial/manual ·
**(X)** unsupported by design. Future design changes update it. It is promoted into
the migration guide so humans and the converter share one reference.

## Appendix A — Compatibility Matrix (Ansible → RoleCall)

Legend: **M** 1:1 · **U** upgrade · **P** partial/manual · **X** unsupported by design

| Ansible construct | RoleCall equivalent | Class | Notes |
|---|---|---|---|
| Play `hosts` | `hosts` | M | string or list |
| Play `roles:` | `roles:` (decision #3) | U→M | native once #3 lands; today rejected by `strictObject` |
| Play `tasks:` | `tasks:` | M | |
| Play `vars:` | `vars:` | M | |
| Play `handlers:` | `listen:` task + `notify` | U | handler block → task with `listen:` |
| Play `gather_facts` | explicit `rolecall facts gather` | P | no implicit auto-gather |
| Play `serial:` | `serial:` | M | |
| Play `strategy: free` | `strategy: free` | M | |
| Play `tags:` | — | X | by design |
| Play `vars_files` / `vars_prompt` | — | P | load via helpers/module; document |
| Play `pre_task` / `post_task` | ordered tasks / `tx` | P | |
| `import_playbook` | `imports:` | M | |
| `import_role` / `include_role` | `roles:` / local `roles/` | U | per #3 |
| `import_tasks` / `include_tasks` | `include_tasks` | M | directive task |
| Task `module:` | `module:` | M | name remap for builtins |
| Task `args` | `args` | M | structured-ref values allowed |
| Task `when:` (Jinja) | `when:` predicate / `$template` | U | Jinja → `$eq` etc. |
| Task `loop:` / `with_items` | `loop:` | U | → `{ $each: { $var: x } }` or literal array |
| Task `register:` | `register:` | M | |
| Task `notify:` | `notify:` | M | |
| Task `delegate_to:` | `delegate_to:` | M | |
| Task `run_once:` | `run_once:` | M | |
| Task `become:` | `become:` | M | |
| Task `become_user` / `become_method` | — | P | only `become: true` → sudo |
| Task `connection:` | — | P | transport chosen by target |
| Task `ignore_errors:` | — | X | RoleCall fails host; use `tx`/guard |
| Task `changed_when` / `failed_when` | — | X | intrinsic idempotency |
| `block` / `rescue` / `always` | `tx` / `checkpoint` | P | rollback intent |
| `set_fact` | `register:` | U | |
| `debug` / `assert` | `debug` / `assert` | M | |
| `service` / `systemd` | `service` | M | |
| `lineinfile` / `blockinfile` | `lineinfile` / `blockinfile` | M | |
| `command` / `shell` | `shell` | M | guard recommended |
| `http` / `uri` | `http` | U | |
| `sql` | `sql` | M | |
| `apt` / `yum` / `dnf` | — | P | package module gap (planned) |
| `copy` / `template` / `file` | `copy` / `http` + `$template` | M | `copy` supersedes `config_write` + `template` |
| `user` / `group` | — | P | gap; document |
| Inventory INI/YAML | `groups:` map | U | format differs; `:children`, glob, precedence close |
| `group_vars/` / `host_vars/` dirs | engine supports via options | P | loader planned (see `design/ansible-compatibility-roadmap.md`) |
| `extra_vars` (`-e`) | — | X | play `vars` only |
| `ansible_*` magic vars | `facts.*` namespace | U | `inventory_hostname` → `host` alias |
| `ansible-vault` | Vault/secret engine (target cap.) | P | |

## Consequences

- **Positive:** native `roles:` (#3) closes the biggest structural gap; mechanical
  conversion lowers the adoption barrier; the strict schema turns unknown keys into
  actionable errors; the converter is self-validating against live Zod (ADR 0003).
- **Negative / cost:** native `roles:` adds a load-time composition path (reuses
  the `imports`/role resolver — moderate). The guide + converter are ongoing
  maintenance tied to schema drift; mitigated by Zod-derived validation and the
  matrix as the single source. Several Ansible constructs (`tags`, `ignore_errors`,
  `block`/`rescue`, `become_user`, `extra_vars`) have **no** RoleCall equivalent — we
  explicitly *do not* promise them, protecting RoleCall's simplicity.
- **Risk:** "compatibility" creeping toward Ansible's footguns (YAML/Jinja escaping,
  implicit templating). Guardrail: decision #2 (upgrade, not preserve) + ADR 0008
  literal-by-default (no `templating` field); conversion never silently renders `{{ }}`.
- **Honesty:** many modules (`apt`/`yum`/`copy`/`file`/`user`) are **not yet
  implemented**; the matrix marks them (P) so the guide/converter do not overpromise
  (per `AGENTS.md` honesty principle).

## Open questions (recommendations)

1. **`roles:` composition semantics** (when #3 is built): recommend role `defaults`
   sit *below* play `vars` (matches Ansible's "role defaults = lowest precedence").
   Confirm at implementation.
2. **Converter packaging:** recommend the `rolecall convert ansible` subcommand (reuses
   the CLI barrel + Zod, gets `/mcp` parity) over a standalone script.
3. **LLM interface:** vendor-neutral — user supplies endpoint/key; the tool only
   builds the prompt and validates output. No embedded provider.
