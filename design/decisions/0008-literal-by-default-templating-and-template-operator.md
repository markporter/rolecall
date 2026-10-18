# 0008 — Literal-by-default string values with opt-in `$template` operator

- Status: **Implemented** (`$template` operator; bare strings are always literal — the `templating` field was removed during alpha)
- Date: 2026-09-27
- Related: ADR 0003 (Zod-driven agent surface); structured-ref system in `src/templating/refs.ts`

## Context

Today, every **string** value in a playbook is implicitly rendered through a
template engine, whether the author asked for it or not:

- `src/executor/context.ts` `renderArgs` (invoked at `src/executor/runner.ts:176`)
  passes each string arg through `renderStr` → `src/templating/fast.ts` → the
  **eta** engine (`autoEscape: false`).
- `evalWhen` and `expandLoop` do the same for string `when` and `loop` values.

eta uses `<%= %>` (output) and `<% %>` (logic) delimiters; `{{ }}` is NOT an eta delimiter and stays literal. Consequently a
bare `command:` / `cmd:` shell string containing `<%=`, `%>`, or `<%` is silently
interpreted: undefined `<%= vars %>` render as `""` (lenient, never throws), and
`<% … %>` executes JavaScript. This is a correctness footgun for shell/awk/JSON/Go-
template content and a latent code-execution surface — and it is entered with no
opt-in.

This contradicts RoleCall's existing structured-ref philosophy: `$var` / `$concat` /
`$call` / `$if` / `$each` and the typed predicate nodes (`$eq`, `$and`, …) are
already **opt-in** `$`-prefixed nodes that never touch a bare string. Only the eta
path is implicit. Note also that the "full Jinja `{{ }}` renderer" is scaffolded and
is only invoked via the explicit `content` `{ template, engine: jinja }` path in
`playbook.ts`; the implicit `{{ }}` authors actually hit today is eta, not Jinja.

## Decision

1. **Flip the default: bare strings are literal.** `resolveArg` returns string
   values unchanged (no `renderStr`). A string is interpreted only when explicitly
   wrapped.
2. **Add a `$template` structured operator** to `REFERENCE_OPS` in
   `src/templating/refs.ts`, handled in `resolveNode` by calling
    `render(operand, vars)`. Authors opt into interpretation per value:
   ```yaml
    - tasks:
        - shell:
            command:
              $template: echo <%= host %> > /tmp/<%= file %>
   ```
3. **Apply consistently** across the three string-interpreting sites:
   `renderArgs`/`resolveArg` (args), `evalWhen` (string `when`), `expandLoop`
   (string `loop`). Bare strings become literal everywhere; interpretation requires
   `{ $template: … }` or an existing structured node (`$var`, `$concat`, `$call`,
   predicate nodes).
4. **Structured nodes remain the preferred type-safe path.** `$template` is the
   opt-in *escape hatch* for legacy `{{ }}`/eta syntax; new authoring should prefer
   `$var` / `$concat` / `$call`.
5. **No `templating` field.** During alpha the gating `templating: legacy|strict`
   field was removed entirely: bare strings are **always** literal and only
   `$template` opts back into EJS rendering. There is no `legacy` mode that
   preserves the old auto-render behaviour. (Final decision — see Consequences.)

## Consequences

- Eliminates silent `{{ }}` / `<%` interpretation for bare strings; shell / awk /
  JSON / Go-template literals are safe without escaping.
- Removes the implicit JS-execution surface (`<% %>`) from ordinary command strings;
  eta runs only inside an explicit `$template`.
- **Breaking for existing playbooks** that relied on implicit `{{ }}` in bare
  `command` / `when` / `loop`. Since the `templating` field was removed in alpha,
  there is no legacy mode to preserve old behaviour; such playbooks must migrate to
  `$template` / structured nodes.
- Adds one operator (`$template`) to the documented surface; the `templating` play
  field was removed during alpha. Both `docs/` and `AGENTS.md` reflect literal-by-default.
- Consistent with the opt-in structured-ref design already in `refs.ts`; no new
  escaping hacks required.
