# 0024 — Ansible analyzer, mechanical converter, and LLM handoff

- Status: **Proposed**
- Date: 2026-11-01
- Related: ADR 0009 (Ansible compatibility and mechanical conversion), ADR 0003 (Zod-driven schema), ADR 0008 (literal-by-default templating), ADR 0013 (`$var` namespacing), ADR 0014 (project/plugin architecture), ADR 0015 (collections), ADR 0016 (plugin SDK), ADR 0022 (secrets/vault), `design/ansible-compatibility-roadmap.md`
- Refines: ADR 0009 §6 (the LLM-assisted conversion tool). This ADR keeps the converter vendor-neutral by emitting **handoff artifacts** for an external agent instead of calling an LLM itself.

## Context

ADR 0009 commits RoleCall to mechanical conversion of existing Ansible
playbooks, roles, and collections, plus a migration guide and an LLM-assisted
conversion path. The compatibility matrix in ADR 0009 Appendix A already
classifies constructs as mapped (M), upgrade (U), partial (P), or unsupported by
design (X), and much of the structural work is already present in `src/`:

- Ansible inventories, `group_vars/`, and `host_vars/` are consumed directly.
- Play-level `roles:`, `handlers:`, `tags:`, `pre_tasks`/`post_tasks`,
  `vars_files`, `imports`, `become_user`, `connection`, `serial`, and
  `strategy` are supported.
- The executor implements `when`, `loop`, `notify`/`listen`, `register`,
  `run_once`, `delegate_to`, tx/checkpoint, and the full builtin module set.
- The strict Zod schema (ADR 0003) is a compatibility feature: it fails closed on
  unknown constructs instead of silently misbehaving.

What is missing is the tool itself. A mechanical converter is the adoption
lever, but it cannot honestly convert everything. Ansible's surface includes:

- Jinja expressions, filters, tests, and lookups,
- Python collection modules with no RoleCall equivalent,
- dynamic includes/roles, `vars_prompt`, `until`/`retries`, and other
  runtime-shaped control flow,
- Jinja templates and Ansible Vault data,
- constructs RoleCall deliberately rejects (`ignore_errors`, `changed_when`,
  `failed_when`, `block`/`rescue`/`always`).

If the converter silently drops or guesses at those, it produces plausible YAML
with wrong behavior. If it refuses to convert anything non-trivial, it is not
useful. The missing piece is an explicit contract for what is mechanical, what is
reviewed, and how the reviewed residue is handed to an agent with enough context
to finish the job safely.

This ADR defines that contract: an analyzer, a mechanical rewriter, and a
versioned LLM handoff bundle.

## Decision

### 1. One command, three phases

Add a single CLI surface:

```sh
rolecall convert ansible <path> [--out <dir>] [--handoff <dir>] [--write] [--strict] [--report json|md]
rolecall convert ansible --validate <dir>
```

The command runs three phases:

1. **Analyze** — parse and classify every construct in the source tree.
2. **Rewrite** — mechanically emit RoleCall files for the constructs the matrix
   marks as safely convertible.
3. **Hand off** — write a self-contained, versioned bundle for everything the
   mechanical rewriter cannot safely finish.

`--write` is required to emit converted files. Without it, the command is a
read-only analysis and prints a summary (or JSON via `-o json`). `--strict`
exits non-zero if any non-mechanical item remains, for CI. `--validate <dir>`
checks an already-converted tree against the RoleCall schema and prints the
remaining handoff items.

### 2. Classification comes from one machine-readable matrix

The compatibility matrix is promoted from prose into a typed data module used by
the analyzer, the rewriter, the handoff generator, and the docs:

```ts
type Disposition = "mapped" | "upgrade" | "partial" | "unsupported";

interface CompatibilityEntry {
  id: string;                 // stable matrix id, e.g. "task.when.jinja"
  construct: string;          // human description
  disposition: Disposition;
  target?: string;            // RoleCall construct or module
  reason?: string;
  handoffKind?: "jinja" | "module" | "structure" | "template" | "vault" | "dynamic";
}
```

The matrix covers play, task, role, inventory, module, collection, and templating
constructs. Module mappings additionally consult the live builtin/registered
module metadata, so a new builtin automatically becomes a conversion target.
The analyzer's `analysis.json` references matrix ids; the handoff bundle carries
the relevant entries so an agent does not need the source tree or this ADR.

### 3. Analyzer

The analyzer is read-only and must never execute source code, invoke
`ansible-playbook`, or decrypt vault data.

It produces a `ConversionModel` that preserves, for every relevant node:

- source path, line, and column (use a CST-capable YAML parser; `js-yaml` is the
  existing parser but does not expose ranges, so the converter may lazy-load a
  range-aware YAML parser rather than replace the rest of the config loader),
- the original raw node,
- the matrix classification and any module mapping,
- relationships (play → tasks → handlers, role → files, collection → roles and
  modules),
- a stable content-derived id so re-runs reconcile against previous handoffs.

The analyzer handles playbooks, roles, and collections:

- playbooks: plays, tasks, handlers, vars, imports, tags, control flow,
- roles: `defaults/`, `vars/`, `handlers/`, `tasks/`, `templates/`, `files/`,
  `meta/main.yml`, `meta/argument_specs.yml`, dependencies,
- collections: `galaxy.yml`, `meta/runtime.yml`, `roles/`, `playbooks/`,
  `plugins/` inventory (module plugins are classified, not translated).

Outputs:

```text
.rolecall/convert/
  analysis.json
  analysis.md
  HANDOFF.md
  handoff/
    manifest.json
    context/
      compatibility.json
      modules.json
      schema-summary.json
      rolecall-rules.md
    items/
      0001-task-when-jinja.md
      0002-module-community-aws-ec2.md
```

### 4. Mechanical rewrite scope

The rewriter is conservative and deterministic. It may mechanically:

- normalize a playbook to a top-level list of plays (ADR 0009 P0),
- pass through supported play fields (`hosts`, `roles`, `handlers`, `tags`,
  `pre_tasks`, `post_tasks`, `vars`, `vars_files`, `imports`, `serial`,
  `strategy`, `gather_facts` as a compatibility no-op),
- rewrite collapsed task form to explicit `module` + `args`,
- map known Ansible modules/FQCNs to RoleCall builtins using the matrix and live
  module metadata,
- translate simple literal `when`/`loop` values and simple `{{ var }}` paths to
  `$var` (and `with_items`/`loop` literals to plain lists),
- map `become`, `become_user`, `connection`, `delegate_to`, `run_once`,
  `register`, `notify`, and supported tags 1:1,
- copy inventories unchanged (they are already consumed directly),
- map role directory structure and role defaults/vars/handlers/tasks to RoleCall's
  role composition model,
- copy static files and flag templates separately.

The rewriter must validate its output against the strict RoleCall schema before
writing. If a node cannot be validated, it is demoted to a handoff item; it is
never written as invalid or silently dropped.

#### Jinja policy: structured refs, then the Jinja engine, never eta

Jinja is **not** mechanically translated to eta/EJS. Eta templates compile to
JavaScript, while Jinja expressions are Python-like; a translation would have to
generate JavaScript, and filter/test/truthiness/whitespace semantics would not
reliably match. It would also turn untrusted Ansible templates into an executable
JS surface. Eta remains a native RoleCall choice (`$template`) for authors who
opt in; it is not an Ansible-conversion target.

The converter applies this order:

1. **Structured refs for provably simple forms.** Translate only when the meaning
   is unambiguous:
   - `{{ var }}` / `{{ vars.x }}` -> `$var: vars.var`
   - simple concatenation -> `$concat`
   - a simple filter with a registered RoleCall helper -> `$call`
   - simple `when:` comparisons -> structured predicates (`$eq`, `$ne`, ...)
   - `loop: "{{ items }}"` -> `$each: { $var: vars.items }`

2. **Preserve everything else as Jinja and run it in the Jinja engine.** Add a
   `$jinja` structured node (explicit opt-in, like `$template`; bare strings stay
   literal per ADR 0008):

   ```yaml
   - name: Render the banner
     module: copy
     args:
       dest: /etc/motd
       content:
         $jinja: |
           {% if env == "prod" %}production{% else %}development{% endif %}
     when:
       $jinja: os_family == "Debian"
   ```

   `$jinja` in args renders a string through `src/templating/jinja.ts`
   (Nunjucks, in the sandboxed render worker described by ADR 0025 §7). In `when` it
   needs a boolean adapter (render
   `{% if <expr> %}true{% else %}false{% endif %}` and parse the result). In
   `loop` it needs a list/JSON adapter; if the expression cannot be represented
   faithfully, it becomes a handoff item.

3. **Jinja templates stay Jinja files.** Converted Ansible `template` tasks keep
   their `.j2` source and render with `engine: jinja` through the existing `copy`
   content spec (`content: { template_file, engine: jinja }`). Do not rewrite
   `.j2` files to eta. The playbook lint must exempt a `copy` content spec's
   `template` / `template_file` payload from the bare-`{{ }}` check: it is an
   opaque runtime template like EJS, not playbook scalar interpolation. Ordinary
   `{{ }}` in task args/`when`/`loop` remains a lint error.

4. **Unsupported Jinja goes to handoff.** Nunjucks is closer to Jinja2 than the
   previous in-process engine but is still not complete: Python methods, some macro
   argument forms, Ansible lookups, and filters/tests without RoleCall equivalents
   are classified by the analyzer and emitted as handoff items with the original
   snippet. The converter must not silently approximate them.
5. **Jinja always renders in the sandbox.** `engine: jinja` and `$jinja` are
   code-capable (Nunjucks compiles to JavaScript) and therefore render only in the
   hidden `__render-template` worker under ADR 0025's isolation backend. They are
   allowed by default (no per-template approval), but require a working bwrap/Docker
   backend; without one they fail closed unless the operator uses the same explicit
   `--isolation none --allow-unsafe-template-code` last resort as other local
   execution. There is no in-process Jinja code path.

This policy keeps the fast typed path for the common case, preserves semantic
fidelity for the long tail, and avoids a Jinja-to-JS translation layer.

### 5. Handoff bundle contract

The handoff bundle is the product boundary between the mechanical tool and an
LLM agent. It is designed to be consumed without access to this ADR or the
original repository.

`HANDOFF.md` contains:

- a one-paragraph project summary and conversion counts,
- the exact tool and source revisions/hashes,
- the order in which items should be handled,
- global constraints (RoleCall syntax rules, forbidden constructs, no `{{ }}`,
  no invented modules, no secret values),
- the validation command(s) to run after each item,
- a list of items with links to their Markdown files.

`handoff/manifest.json` is the machine-readable index:

```json
{
  "schemaVersion": 1,
  "tool": "rolecall",
  "toolVersion": "0.0.3",
  "sourceHash": "sha256:...",
  "generatedAt": "2026-11-01T00:00:00.000Z",
  "counts": {
    "mapped": 120,
    "handoff": 7,
    "unsupported": 2
  },
  "items": [
    {
      "id": "0001-task-when-jinja",
      "kind": "jinja",
      "severity": "high",
      "source": {
        "path": "playbooks/site.yml",
        "line": 42,
        "column": 7
      },
      "target": {
        "path": "playbooks/site.yml"
      },
      "matrixId": "task.when.jinja",
      "summary": "Jinja conditional combines a variable and a filter",
      "validation": [
        "rolecall convert ansible --validate ."
      ],
      "dependsOn": []
    }
  ]
}
```

Each `items/<id>.md` is a standalone work order containing:

- **Source** — file, line, column, and the exact original YAML/Jinja/Python
  snippet (secrets redacted, vault payloads replaced by placeholders).
- **Why this was not mechanical** — the matrix id, disposition, and a concrete
  explanation, not a generic “unsupported”.
- **Target** — the RoleCall file to edit and the surrounding converted content, so
  the agent has context without rereading the whole project.
- **Suggested shape** — the closest RoleCall construct, module, or structured-ref
  form. For Jinja items this is either a `$var`/`$concat`/`$call` rewrite or a
  `$jinja` snippet to preserve; for template files it is the `copy` content spec
  with `engine: jinja`. It may include examples in valid block-style YAML. Jinja
  items also note that rendering requires the ADR 0025 sandbox worker.
- **Constraints** — semantics that must be preserved, constructs that are
  forbidden, and explicit non-goals (for example, do not translate a Python
  module implementation).
- **Validation** — the command(s) to run and the expected pass condition. The
  validator re-runs the analyzer and reports any remaining items.
- **Acceptance** — a small, checkable condition: schema validation passes, the
  behavior is expressed with named RoleCall modules, a fixture still runs, or a
  documented divergence is recorded.
- **Dependencies** — other item ids that must be completed first.

The handoff bundle must be deterministic: two analyzer runs over the same source
hash produce byte-identical `manifest.json` and item ordering. Stable ids are
derived from the source path plus node path, not random values.

### 6. LLM workflow and validation loop

The converter does **not** call an LLM. The operator or harness may feed the
handoff bundle to any agent. The intended loop is:

1. `rolecall convert ansible <path> --write --handoff .rolecall/convert`
2. Feed `HANDOFF.md` and the item files to the agent.
3. The agent edits the converted RoleCall tree.
4. `rolecall convert ansible --validate <dir>` re-analyzes the tree and reports
   remaining or newly introduced handoff items.
5. Repeat until `--strict` passes or the operator accepts documented divergences.

Validation must be able to run without the original Ansible tree, using the
converted RoleCall files plus the handoff manifest. It checks schema validity,
unknown modules, unresolved placeholders, and any `REVIEW` markers.

### 7. Safety and security

- Never execute source playbooks, roles, collection modules, or plugins.
- The analyzer/converter never invokes `ansible-playbook`, imports Python modules,
  or evaluates Jinja. Runtime `$jinja` nodes are evaluated later by the sandboxed
  RoleCall Jinja worker, not during analysis.
- Never decrypt vault data; classify it and redact it. Vault items reference
  ADR 0022 and carry placeholders only.
- Treat all source paths as untrusted: reject traversal outside the output root.
- Do not include secret-looking values in handoff artifacts. The analyzer applies
  the same `SecretRegistry`-style redaction or a conservative pattern scan for
  vault headers, `vault_password`, and encrypted blobs.
- The mechanical rewriter only emits files under the explicit `--out` root.

### 8. Non-goals

- Translating arbitrary Python Ansible modules or collection plugins to
  TypeScript.
- Executing Ansible to compare behavior at conversion time.
- A complete Jinja parser. The mechanical tier handles simple variable paths;
  everything else stays Jinja and runs in the Jinja engine or becomes handoff.
- Translating Jinja to eta/EJS. Eta is a native RoleCall authoring choice, not a
  compatibility target.
- Preserving comments or original formatting in mechanically rewritten YAML.
  The handoff item retains the original snippet.
- Guaranteeing semantic equivalence without operator review.
- Calling an LLM from the RoleCall binary.

## Work items

1. Promote the compatibility matrix into `src/convert/ansible/matrix.ts` and keep
   the ADR 0009 appendix generated from or linked to it.
2. Add the `src/convert/ansible/` module: `analyze.ts`, `rewrite.ts`,
   `handoff.ts`, `validate.ts`, `types.ts`.
3. Add `rolecall convert ansible` to the CLI HELP/dispatch and support `-o json`
   summaries.
4. Implement the range-aware YAML source model (lazy dependency or a minimal
   position mapper) without changing the existing config loader.
5. Implement mechanical playbook and role rewriting with strict schema
   validation and demotion-to-handoff on any failure.
6. Add the `$jinja` structured node (args/when/loop adapters) backed by
   `src/templating/jinja.ts` (Nunjucks) and the ADR 0025 `__render-template` worker;
   keep `$template` eta for native authors.
7. Implement the Ansible filter/test/global compatibility layer and the Jinja feature
   classifier (Nunjucks-supported vs handoff), plus template-file mapping to `copy`
   with `engine: jinja`.
8. Implement the module/FQCN map from matrix + live module metadata.
9. Implement deterministic `manifest.json`, item ordering, and redaction.
10. Implement `--validate` and the analyzer re-run loop.
11. Add fixtures for playbooks, roles, collections, Jinja, templates, vault, and
    unsupported modules; add golden converted outputs and handoff snapshots.
12. Add the migration guide and four-surface docs sync (AGENTS/README/design/docs).

## Acceptance criteria

- The analyzer parses valid Ansible playbooks/roles/collections without executing
  them and classifies every relevant construct with a matrix id.
- Every non-mechanical construct produces exactly one handoff item; nothing is
  silently dropped.
- Mechanically converted output always validates against the strict RoleCall
  schema.
- Jinja is never emitted as eta/EJS: simple forms become structured refs, the
  rest is preserved as `$jinja` or flagged for handoff.
- The loader lint allows `{{ }}` inside an explicit `copy` content template spec
  (Jinja or EJS) while continuing to reject bare `{{ }}` in ordinary playbook
  scalars.
- Handoff items are self-contained, ordered, deterministic, and contain no secret
  values.
- `--strict` fails when handoff items remain; `--validate` reports the remaining
  items after an agent edits the tree.
- Two analyzer runs on the same source hash produce identical manifests.

## Alternatives considered

- **One-shot LLM converter** — rejected as the primary path. It hides what was
  mechanical, is hard to reproduce, and cannot guarantee schema validity or
  secret safety. The handoff bundle gives the LLM only the residue.
- **Mechanical-only converter** — rejected. It would either silently drop or
  reject too much of the real Ansible corpus.
- **Embedded LLM provider** — rejected (ADR 0009 §6). RoleCall stays
  vendor-neutral; the handoff is model-agnostic.
- **Convert collections by translating Python modules** — rejected as
  infeasible. Collection structure and known FQCN mappings are in scope; Python
  module implementations are not.
- **Preserve comments/formatting with a CST round-trip** — deferred. The
  mechanical tier is structural; the original snippet is preserved in the
  handoff item for review.

## Open questions

- Which range-aware YAML parser to use, and whether to add it as a lazy runtime
  dependency or implement a small source-position mapper over `js-yaml`.
- How much of the simple Jinja subset is mechanical in v1: bare `{{ var }}` only,
  or also `when` comparisons and simple filters.
- Which Nunjucks feature gaps warrant engine extensions (custom tests, `is
  defined`, additional filters, Ansible lookups) versus handoff items.
- Whether `$jinja` in `when`/`loop` should evaluate through the sandboxed render
  worker or a dedicated expression adapter in the same worker.
- Whether `analysis.json` should be the canonical data and Markdown generated, or
  both generated from a shared IR.
- Whether to emit a `REVIEW.md` compatibility summary in addition to the item
  files for human operators.
