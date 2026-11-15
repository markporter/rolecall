# 0031 — Mechanical Eta conversion for Ansible templates, with LLM completion

- Status: **Proposed**
- Date: 2026-11-14
- Related: [ADR 0024](0024-ansible-analyzer-and-mechanical-converter.md) (analyzer, rewriter, conversion-gaps bundle), [ADR 0009](0009-ansible-compatibility-and-mechanical-conversion.md) (mechanical conversion mandate), [ADR 0008](0008-literal-by-default-templating-and-template-operator.md) (literal-by-default templating), [ADR 0025](0025-local-execution-isolation.md) (restricted template code renders in the sandbox worker)
- Amends: ADR 0024 §“Jinja policy: structured refs, then the Jinja engine, never eta”. The default remains “never eta”; this ADR adds an explicit opt-in conversion tier.

## Context

ADR 0024 preserves Jinja rather than translating it. The converter maps an Ansible
`template` task to `copy` with `content: { template_file, engine: jinja }`
(`src/convert/ansible.ts`) and copies `.j2` assets verbatim. The policy is safe and
faithful, but it leaves every template as Jinja even when the construct set is tiny
and mechanically obvious.

The earlier rationale overstated the gap. Eta is executable JavaScript, so every
Jinja construct is *expressible* in Eta. `{% for %}`, `loop.index`, and `{% set %}`
have direct JS shapes:

| Jinja | Eta |
| --- | --- |
| `{{ x }}` | `<%= x %>` |
| `{% if c %}A{% else %}B{% endif %}` | `<% if (c) { %>A<% } else { %>B<% } %>` |
| `{% for x in xs %}` | `<% for (const x of xs) { %>` |
| `loop.index` / `loop.index0` | `<%= i + 1 %>` / `<%= i %>` |
| `loop.first` / `loop.last` | `<%= i === 0 %>` / `<%= i === xs.length - 1 %>` |
| `{% set x = e %}` | `<% const x = e %>` |
| `x \| default("y")` | `<%= default(x, "y") %>` |

The real costs are mechanical: parsing Python-like expressions and emitting correct
JS, preserving scope and `loop` semantics, mapping filters/tests, and keeping
undefined/truthiness behavior identical. There is also a policy cost: converted
output is executable restricted code.

The desired conversion workflow is mechanical-first, LLM-second. The mechanical
tier should finish the simple majority and leave the LLM a working draft plus a
precise list of gaps, rather than either refusing the file or leaving an all-Jinja
passthrough. ADR 0024 already defines the gap contract and its per-item work
orders; this ADR extends that contract to template files.

Current code constraints:

- One template file is rendered by one engine. A file cannot mix Jinja and Eta.
- Eta’s runtime context exposes only registry filters (`src/templating/fast.ts`);
  `ANSIBLE_FILTERS` / `ANSIBLE_TESTS` / `ANSIBLE_GLOBALS` are attached only to the
  Nunjucks environment (`src/templating/jinja.ts`).
- Nunjucks ships an (undocumented) parser that produces an AST, so classification
  and code generation can be AST-driven rather than regex-driven.
- `convert ansible` currently runs no template pass at all; non-YAML files are
  copied verbatim.

## Decision

### 1. Default unchanged; conversion is opt-in

`rolecall convert ansible` keeps `engine: jinja` and verbatim `.j2` output by
default. Add an explicit template mode:

```sh
rolecall convert ansible <path> --templates keep   # default
rolecall convert ansible <path> --templates eta    # attempt mechanical Eta output
```

`--templates eta` still obeys `--write` / `--strict`: in dry-run it reports what
would convert; under `--strict` any `review`/`gap` template item fails the run.

### 2. Template pass is per file and engine-exact

The pass targets only template surfaces:

- `.j2` files referenced by a converted `template` task or a `copy` content spec
  with `engine: jinja`;
- inline `copy.content.template` strings that already carry `engine: jinja`.

Playbook scalar Jinja is out of scope. It continues to follow ADR 0024’s policy:
structured refs where trivial, `$jinja` otherwise. `$jinja` is not rewritten to
Eta by this pass.

Conversion is committed **per whole file**. If any construct in the file is not
safely translatable, the file is not emitted as Eta; the original `.j2` is
preserved and the draft goes to gap. There are no half-converted templates in
the output tree.

### 3. AST classification with three dispositions

Parse with the Nunjucks AST and classify every node:

- **mapped** — output expressions; `if`/`elif`/`else`; `for` (including `else` and
  `loop.index`, `index0`, `first`, `last`, `length`, `revindex`, `cycle`); `set`;
  comments; simple attribute/index access; filters/tests with defined JS
  equivalents; `raw`.
- **review** — constructs whose fidelity depends on edge cases: `map`/`select`/
  `reject` with attribute expressions, `namespace`, mutation across loop scopes,
  `default(omit)`, truthiness-sensitive comparisons, whitespace-control trim
  markers, or any test whose undefined behavior differs between Nunjucks and JS.
- **gap** — macros, `call`, `import`/`from`, `include`, `extends`, `block`,
  `filter` blocks, lookups/`query`/`q`, Python-only methods, unknown filters or
  tests, and dynamic constructs the parser cannot resolve.

Classification is deterministic and recorded per construct. A file containing a
`gap` construct is not converted; a file with only `mapped` constructs is
converted; a file with `review` constructs is converted only when the construct’s
review rule is explicitly accepted (otherwise it is treated as gap).

### 4. Output contract

For a converted file:

- write `<name>.eta` beside the converted playbook;
- rewrite the task to `content: { template_file: <name>.eta, engine: eta }`;
- keep the original `.j2` out of the converted tree to avoid drift;
- record the source→output mapping in `manifest.json`.

For a file with unresolved constructs:

- copy the original `.j2` unchanged and keep `engine: jinja`;
- emit a gap item under `conversion_gaps/items/<id>.md` (ADR 0024 contract) plus a
  standalone draft at `conversion_gaps/templates/<id>.eta.draft`;
- the draft is complete Eta with `/* GAP: <construct> @ <line> */` delimiters
  marking each unresolved fragment, so an LLM edits gaps rather than starting
  from scratch.

Each template work order includes the original snippet and source location, the
per-construct disposition and reason, the partial Eta draft, the runtime helper
mappings used, and a render-equivalence fixture or a statement that no fixture is
possible.

### 5. Runtime parity is a prerequisite

Before code generation ships, Eta’s render context must match the Jinja runtime for
the supported subset:

- expose `ANSIBLE_FILTERS`, `ANSIBLE_TESTS`, and the relevant `ANSIBLE_GLOBALS`
  (`omit`, `now`) to the Eta context, or generate explicit calls against the same
  callables — one filter implementation, two engine adapters;
- provide loop metadata (`loop.index` etc.) for converted `for` nodes, including
  nested-loop shadowing;
- define undefined and truthiness behavior per construct: Eta’s lenient proxy
  currently renders missing values as `""`, while Nunjucks strict mode throws, so
  converted templates must not silently change behavior;
- keep `autoEscape: false` and literal whitespace parity; any `{%-`/`-%}` trim is
  review-only until a trimming rule is verified.

### 6. Security and execution

- Conversion parses and rewrites; it never executes a template.
- Eta output is restricted code. Converted `engine: eta` templates require the
  ADR 0025 approval/sandbox path exactly like hand-written Eta, and are never run
  under `--isolation none` without the existing unsafe escape hatch.
- Gap artifacts redact secret-looking values per ADR 0024; original template
  text is included only as needed for the work order.
- `--templates eta` must not widen the default trust posture: without the flag,
  converted trees contain no new executable template surface.

### 7. Validation

- `rolecall convert ansible --validate <dir>` checks that every converted template
  reference resolves, that `engine` matches the file extension used, and that no
  file is half-converted.
- The test suite adds golden fixtures that render the original Jinja and the
  converted Eta with the same defined vars and byte-compare output. Fixtures cover
  each `mapped` construct; `review` constructs require an explicit expected-output
  fixture before they can be promoted to `mapped`.
- The analyzer remains offline and deterministic; two runs over the same source
  hash produce identical classification, draft bytes, and manifest ordering.

### 8. Implementation slices

1. **Analyzer only** — AST parse, classification, `manifest.json` and work-order
   emission. No rewritten templates. This is immediately useful to LLM workflows.
2. **Runtime parity** — Eta context helpers and shared Ansible filters/tests, with
   parity tests against Nunjucks for defined-value cases.
3. **Mapped codegen** — output, `if`, `for` + loop metadata, `set`, comments, and
   simple filters; golden render-equivalence tests.
4. **CLI and docs** — `--templates eta`, output mapping, strict-mode behavior,
   updates to ADR 0024’s cross-reference, `AGENTS.md`, `README.md`, `design/`, and
   `docs/content/concepts/templates.md`.

## Consequences

Positive:

- The mechanical tier finishes the common template majority instead of leaving it
  all to an LLM.
- Gap items become working drafts with precise gap markers, shortening the LLM
  loop and making acceptance testable.
- Default behavior and fidelity are unchanged; the new path is opt-in.

Negative:

- RoleCall must maintain a Jinja-expression-to-JS code generator and its parity
  matrix.
- `review`/`gap` classification adds surface area to the converter and gap
  schema.
- Converted templates become executable restricted code and need approval even
  though their source was inert.

Mitigations:

- Keep the convertable subset deliberately small and fixture-driven; promote a
  construct to `mapped` only with a passing render-equivalence test.
- Preserve the original `.j2` whenever a file is not fully convertible.
- Keep `--templates keep` as the default and the safe choice for untrusted trees.

## Alternatives considered

- **Keep ADR 0024 unchanged (Jinja-only).** Safest, but leaves mechanical value on
  the table and forces the LLM to do even trivial loop/`set` templates.
- **Regex-based translation.** Rejected: cannot parse nested expressions, filters,
  scoping, or whitespace-control tags reliably.
- **Full Jinja→Eta compiler including macros/includes/extends.** Deferred: high
  maintenance and low payoff; those constructs stay `gap`.
- **Translate inline playbook `$jinja` to Eta.** Rejected: playbook expressions
  remain structured refs or `$jinja`; template conversion applies only to template
  files/specs.
- **Runtime translation or dual-engine rendering.** Rejected: hides conversion
  results, makes output non-deterministic, and adds another execution path.

## Non-goals

- Calling an LLM from the converter. The conversion-gaps bundle remains the product
  boundary.
- Converting arbitrary Python modules, collection plugins, or Ansible lookups.
- Removing Jinja support or changing `$jinja` semantics.
- Guaranteeing byte-identical rendering for `review` constructs before a fixture
  proves it.
