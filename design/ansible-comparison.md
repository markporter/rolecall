# RoleCall vs. Ansible — Complaint-Driven Design Comparison

> Research synthesis: common, well-sourced criticisms of Ansible, mapped against
> RoleCall's actual implemented design and its work plan. Purpose: identify which
> Ansible flaws RoleCall already addresses, and which gaps RoleCall should design a
> solution for.

---

## 1. Where Ansible hurts (the evidence)

Primary source: Carreira, Saavedra, Mendes, Ferreira — *"The Ultimate
Configuration Management Tool? Lessons from a Mixed Methods Study of Ansible's
Challenges"* (EASE 2026, arXiv:2504.08678). A mixed-methods study of **59,157
posts** (Stack Overflow, Reddit r/ansible, Ansible Forum) + **20 practitioner
interviews** (Beginner/Intermediate/Experienced). Corroborated by UpGuard
pros/cons, TechTarget network-automation limitations, and InfoWorld review.

### Complaint distribution by theme (recent posts, ~24k analyzed)

| Theme | Share of recent posts | Top sub-issues |
|---|---|---|
| **Control / data-flow & execution** | 44.4% | Loops (13.9%), SSH connection issues (12.7%), Variable management (12.3%), Conditional execution (10.6%), Undefined variables (10.4%); sequential-execution slowdown, no sync primitives, **statelessness (no state preserve/compare)**, push/agentless complicating continuous enforcement |
| **Lack of support** | 38.2% | AWX/Tower issues (17.3%), module execution failures (10.7%), integration issues, **Windows challenges (7.7%)**, "have to write your own module" |
| **Reliability** | 37.2% | Error handling (14.2%), file/permissions, **hard to debug (n=10)**, "stuck 15 min with no terminal change" (B2), **cryptic module error messages (n=5)** |
| **Usability** | 18.8% | Jinja2 (29.1% of usability), quoting (19.7%), playbook inputs (17.9%), **YAML syntax (9.8%)**; beginners struggle (n=12), **escaping hell** ("8 hours on YAML SQL escaping" — E5) |
| **Performance & scalability** | 8.1% | Dynamic inventories (29%), inventory mgmt (27.3%), performance (16.3%); **doesn't scale past hundreds of hosts, no agent** (E4), slow execution (n=8) |

### The study's four recommended improvements
1. **Stronger failure locality** to support debugging.
2. **Clearer separation of language and templating boundaries** (YAML + Jinja2 blur).
3. **Targeted documentation.**
4. **Improved execution backends** to address performance.

### Additional well-known criticisms (practitioner/industry)
- No notion of state; sequential tasks, stops on first error, no dependency system (UpGuard).
- JSON serialization/deserialization CPU cost on large data volumes (TechTarget).
- Complex data structures & control flow are awkward.
- Vault limitations; secrets leaking into logs.
- Collection/dependency management friction (galaxy, requirements.yml).
- Limited debugging tooling (playbook debugger has only 5 triggers).

---

## 2. RoleCall design vs. those flaws

| Ansible flaw | RoleCall's design response | Status |
|---|---|---|
| Slow templating / YAML+Jinja escaping hell | Dual-mode templating: fast **eta/vento compiled-to-JS** default + optional **LiquidJS Jinja-mode**; **lenient undefined resolution** (empty string) by default so runtime-secret placeholders don't throw; shared filter registry; **structured-reference alternative** (`$var`/`$concat`/`$call` nodes) proposed for escapeless, type-safe values — see §6 | ✅ Addressed (structured refs implemented; see §6) |
| Painful extensibility / Python-only modules | **First-class JS/TS plugin SDK** — author a module in ~one function, dynamic `.ts/.js` load, no build step. Explicitly the #1 user differentiator | ✅ Addressed |
| No notion of state / stateless | **Idempotency intrinsic to module contract**; check-compare-write + observed-state cache + skip-unchanged; **observe-and-reconcile minimal delta** by default; `rolecall_managed_only` flag governs drift ownership | ✅ Addressed |
| SSH overhead / per-task connections | **Pure-JS ssh2, channel multiplexing** (1 TCP/SSH session, many channels), keepalive, **centralized resilient runner** (retry/timeout/concurrency) | ✅ Addressed |
| Bad error messages / stuck runs / no failure locality | `ExecResult.error.class` typed (`auth`/`timeout`/`network`/`fatal`/`retryable`); decorators **bail on fatal, retry retryable**; timeouts + health checks + backpressure metrics | 🟡 Partial |
| Scalability past hundreds of hosts | **Bun runtime** + bounded async fan-out (`p-limit`) ≫ CPUs + CPU-bound worker pool sized to `os.cpus()`; connection reuse | ✅ Addressed |
| Tower/UI lacking & out-of-sync | **Built-in Express orchestrator** (scheduler + webhooks + REST) + pluggable served SPA, same binary | ✅ Addressed (UI optional) |
| AWX complexity | Lightweight first-class orchestrator instead of heavy AWX | ✅ Addressed |
| Variable precedence confusion | Explicit documented precedence (role-default < role-vars < inventory-group < inventory-host < play < extra-vars); unknown var → clean "unknown variable" error, not NaN/crash | ✅ Addressed |
| Continuous enforcement gap | **Optional agent mode** (WebSocket/gRPC, agent dials out, resumable task IDs, NAT-reachable) | 🟡 Partial (opt-in, not default) |
| Dynamic inventory pain | Inventory **plugin interface** (static + dynamic file/env built-ins), deterministic per-host var resolution | 🟡 Partial |
| Windows/WinRM | Now a **target capability** (see `goals.md`); sidecar design sketched in brief | ⏳ Planned |
| Secrets / Vault | Now a **target capability** (see `goals.md`); vault-reference + injection designed | ⏳ Planned |

---

## 3. What RoleCall explicitly fixes (the wins)

RoleCall's plan reads as a near-direct answer to Ansible's top study themes:

- **Templating speed** → fast compiled engine (eta/vento).
- **Extensibility** → JS/TS SDK (user's stated #1 complaint: "creating plugins harder than making playbooks").
- **Statelessness** → intrinsic idempotency + observe-reconcile + cache.
- **SSH/scale** → multiplexed pure-JS connections + bounded fan-out on Bun.
- **Failure locality** (study rec #1) → typed error classification + retry/bail decorators.
- **AWX/Tower complaints** → built-in orchestrator, no separate drifting UI.

---

## 4. Gaps RoleCall should design a solution for

> **Status:** as of this writing, **secrets management** and **Windows/WinRM** are
> promoted to explicit target capabilities in `goals.md`; this section remains the
> design rationale for *how* to close them, not whether they will be built.

Ordered by leverage against Ansible's documented complaints.

1. **Secrets management (highest-priority gap).** Ansible Vault is widely
   criticized, but RoleCall has *nothing* — only env-var injection. Design a
   vault-reference resolution layer + secret injection that **never renders
   secrets into logs/stdout**. Table-stakes for the facts+templating pipeline
   RoleCall already builds.

2. **Windows/WinRM.** 7.7% of Ansible support posts; RoleCall defers it. The brief
   already names the right shape (`pywinrm` sidecar behind the `Connection`
   trait) — promote from "eventual" to a designed work item early; it's the
   highest-risk transport and the trait is already built to absorb it.

 3. **Real debugging / observability, not just error classes (study rec #1).**
    Study's loudest reliability complaint is "hard to debug" (n=10) and stuck runs
    (B2: "stuck 15 min with no terminal change"), plus cryptic module errors (n=5).
    RoleCall has `--check`/`--diff` and typed errors, but no step-through, no per-task
    diff replay, no run introspection, and **no built-in performance profiling**
    (Ansible's "why is this playbook slow?" is famously hard — only third-party
    `profile_tasks` callbacks). A concrete design is now on the table (see §7):
    a structured **RunTrace** in SQLite (per run/host/task/phase, with per-phase
    timings) that doubles as a profiler, plus replay + failure-locality snapshot.
    Status: **Designed (not yet implemented)** — rides on the existing SQLite store
    (todo 19) and diff engine (todo 13); only the trace schema + surfacing are new.

 4. **Language/templating boundary (study rec #2).** RoleCall still *mixes* YAML
    config + templating, so the "blurred boundary" problem persists. Two concrete
    designs are now on the table (see §6):
    - **Explicit structured references** (`$var` / `$concat` / `$call` nodes) as an
      escapeless alternative to `{{ }}` string interpolation — template syntax
      leaves the scalar-string layer entirely, so YAML only quotes ordinary data.
    - **Typed `when`/`loop`** as structured predicates instead of Jinja strings,
      plus **template error location** (line/col in source template).
    Status: **Designed (not yet implemented)** — both depend on the Wave 2
    templating work, which is still planned, not built (`src/template/` does not
    exist yet; `args`/`when`/`loop` are currently `z.unknown()` in the schema).

 5. **Resumability / rollback across tasks.** Ansible has no native rollback; RoleCall
    gets device-side atomic commit + revert timer *for switches*, but no general
    cross-task checkpoint/rollback. The agent-mode "resumable task IDs" is a hook
     — extend to a general executor resume/undo. Status: **Designed (see §8)** — a
    transaction-ID + checkpoint model for dependent plays, best-effort rollback, and
    resume, riding on the todo 25 ledger.

 6. **Large-fact-set performance.** TechTarget flags Ansible's JSON-serialization
    CPU cost. Bun is fast, but pushing huge fact sets over SSH per host still
    bites at scale — consider **fact throttling/streaming** and targeted/cached
    facts as default-on.

 7. **Module/OS coverage & ecosystem.** Ansible's "lack of support for some
    modules / limited OS support" is answered only by a builtin base set mapped
    from Ansible roles. The deferred **plugin marketplace** is the longer-term
    answer; near-term, a clear "write a module" contribution path (the SDK
    already enables it) reduces the gap.

 8. **Compliance/drift reporting as first-class.** RoleCall reconciles on run but
    **continuous drift detection is deferred**. A `rolecall compliance` / drift-report
    mode (read-only observe pass) would directly answer the "removing config
    doesn't undo old changes" and configuration-drift complaints — cheap given
     the observe-and-reconcile machinery already exists.

 9. **Non-idempotent shell overuse.** Ansible users reach for `shell`/`command` because
    of module coverage gaps, heavy module-authoring friction (study Lack-of-support 38.2%
    "write your own module"), poor discoverability, and insufficient facts for inspection.
    RoleCall's intrinsic-idempotency contract + cheap TS module authoring attack the *friction*,
    but the *coverage + discoverability* gaps remain. Design a two-layer fix (see §9): a
    batteries-included module picklist that displaces shell, and a `rolecall/module` idempotency
    helper lib that makes custom idempotent modules ~5 lines; plus `rolecall modules search` + a
    lint guard on unguarded shell.     Status: **Designed (see §9)**.

 10. **LLM-agent ergonomics (clientless MCP over REST).** Making RoleCall usable by external LLM
    agents without a separate MCP server: reuse the orchestrator REST (todo 18) as a
    self-describing, discoverable tool surface (`GET /mcp` manifest generated from the Zod
    schema) so a minimal LLM skill is the whole integration. Pushes the AI harness outside
    RoleCall (lower risk, vendor-neutral). Status: **Designed (see §10)**.

---

## 5. Bottom line

RoleCall's design deliberately targets Ansible's three heaviest study themes
(templating speed, extensibility, state/scale) and the #1 academic
recommendation (failure locality). The open items most worth designing now are
**secrets**, **Windows/WinRM**, **debugging observability**, and **the
language/templating boundary** — all either deferred in the plan or only
    partially covered by current design. The templating-boundary gap now has a
    concrete design direction (§6: explicit structured references + typed control
    flow), and the debugging/observability gap now has one too (§7: RunTrace +
    replay + failure-locality + built-in performance profiling). The rollback/resume
    gap now has a design too (§8: transaction-ID + checkpoint model for dependent plays),
    and the non-idempotent-shell gap now has one (§9: batteries-included modules +
    `rolecall/module` idempotency helper lib + module search/lint guard). The LLM-agent surface
    now has one too (§10: clientless REST MCP + outside-harness philosophy).

---

## 6. Proposed design: explicit structured templating references

> **Status: Implemented.** Shipped as `src/templating/refs.ts` (`$var` / `$concat` / `$call` / `$if` / `$each` / `$template`, with the fully-qualified `facts` namespace for observed facts); validated live by `lintTemplateRefs` and surfaced by `rolecall vars list` / `rolecall vars trace`. The separate `$fact` operator was removed in ADR 0013.

Concrete answer to gap #4 (study rec #2). Goal: remove the *template-layer*
escaping (the `{{ }}` / `|` / `%` characters that collide with shell/Jinja inside
one string) without leaving YAML.

**Core idea — move templating out of scalar strings into the data tree.**
YAML only applies quoting rules to scalar strings; a nested object is plain data.
So a value expressed as a structured node never needs template-character escaping.

- **Single-value reference** (the common case): `args: { target: { $var: inventory_hostname } }` — no `{{ }}`, no quotes to fight.
- **Composite value**: `args: { name: { $concat: [ { $var: inventory_hostname }, "-", { $var: app_port } ] } }`.
- **Helper call**: `args: { title: { $call: title, args: [ { $var: site_name } ] } }` — `title()` is a registered helper.

**Typed control flow.** The same node shapes apply to conditionals/loops:
`when: { $eq: [ { $var: os_family }, "Debian" ] }` instead of a Jinja string.
This makes `when`/`loop` type-checked and escapeless — directly addressing the
study's top control-flow complaints (loops 13.9%, conditionals 10.6%).

**Escape hatch for real complexity.** Import a TS helper file and call into it:
`helpers: ./lib/helpers.ts` then `{ $call: buildName, args: [...] }`, where
`buildName` is real TS (full types, zero escaping). Pairs with RoleCall's planned
JS/TS plugin SDK and Bun runtime `.ts` loading.

**Security dividend.** Because `$var`/`$call` can only look up data or invoke
*registered* helpers, the form has **no arbitrary-code-execution surface** — unlike
raw `{{ }}` in Jinja, which can call functions. This doubles as the untrusted-template
guard the plan already wants. Scope helper imports to trusted, project-local modules
(not remote code).

**Caveats.**
- Keep the structured DSL *tiny* (`ref`/`concat`/`call`, maybe `if`/`each`). Don't
  reinvent Jinja as JSON, or the blur returns in structured form; push anything
  beyond those primitives into a TS module.
- Residual YAML *scalar* quoting remains for literal values (e.g. `"Debian"`), but
  those are plain data, not template expressions — the layered collision is gone.
  The programmatic TS path removes even that residual quoting.
- Depends on Wave 2 templating (eta/vento + LiquidJS) which is **planned, not yet
  built** (`src/template/` absent; `src/config/schema.ts` currently types
  `args`/`when`/`loop` as `z.unknown()`).

---

## 7. Proposed design: run trace, replay & failure-locality (+ performance profiling)

Concrete answer to gap #3 (study rec #1 — stronger failure locality; reliability
complaints "hard to debug" n=10, stuck runs, cryptic errors n=5; performance
themes: sequential slowdown, scaling past hundreds of hosts, slow exec n=8,
SSH 12.7%). Goal: make RoleCall debuggable and *profiling-capable by construction*,
not just error-classed.

**Core idea — persist a structured RunTrace; timing is just another phase attribute.**
Reuse the existing SQLite store (todo 19) and diff engine (todo 13). One row per
`(run_id, host, task_index, phase)` capturing: `when`/`loop` eval → args render
(with template source location from §6/todo 24) → transport exec (command) →
stdout/stderr → before/after diff → result + `ExecResult.error.class`. Every phase
records `started_at`/`ended_at`.

**Why this also gives performance statistics (the user's question).** Because each
phase is timestamped, the same trace is a profiler with zero extra machinery:
- **Per-host connect time** → surfaces slow targets / network (Ansible's SSH 12.7%).
- **Per-task exec duration** → surfaces slow commands/modules.
- **Render duration** → surfaces heavy templating / huge fact sets (TechTarget
  JSON-serialization cost; comparison-doc gap #6).
- **Diff/compare duration** → surfaces expensive change-detection.
- **Facts-gather time + cache hit rate** (todo 14) → surfaces full-sweep vs targeted.
- **Fan-out timeline** → with `serial` batches + `strategy free`/`linear` (todo 12)
  and the CPU-bound worker pool (todo 22), a per-host/per-task Gantt shows whether
  `--forks` is too low or a `serial` gate is throttling. This directly answers
  "why is the playbook slow?" — Ansible has no built-in answer (only `profile_tasks`
  callback plugins); RoleCall bakes it in.

**Failure locality (rec #1) made real.** On error, auto-attach the *rendered*
command, last N output lines, the diff RoleCall *would* have applied, and the source
location. The trace also shows exactly which phase/host/command hung (kills the
"stuck 15 min, no idea where" class of bug).

**Surfacing.** `rolecall playbook run --trace`/`--profile`; `rolecall run replay <id>`;
orchestrator `/runs/:id/trace` + `/runs/:id/profile` endpoints; a timeline/Gantt +
slowest-host/task rollups in the UI (todo 23). Persistence is **mode-agnostic**:
CLI runs write the *same* SQLite store as `--serve` (the HTTP endpoint is just one
surface), so replay/inspection works without launching the server — directly fixing
Ansible's gap where `ansible-playbook` leaves you with only stdout, no durable record.
Add a `rolecall playbook run --step`
breakpoint (beats Ansible's 5-trigger debugger — the trace is structured/queryable).

**Caveats.**
- **Mask secrets** in the trace (per the deferred secrets design) — never persist
  rendered secret values.
- Keep it pure-JS SQLite so it stays cross-runtime (todo 19 parity caveat).
- Trace capture must be low-overhead (write batched, async) so profiling doesn't
  itself distort the timings.

---

## 8. Proposed design: transaction + checkpoint model for dependent plays (rollback & resume)

Concrete answer to gap #5. Goal: flag dependent vs independent plays, give all-or-nothing
rollback for a group, and allow partial rollback + resume. Builds on the §7 RunTrace/ledger:
every applied delta row carries `tx_id` + `checkpoint_id`.

- **`tx: <id>`** groups plays/tasks into one coordinated unit. Plays sharing a `tx` are
  *dependent* (coordinate; failure of any member triggers rollback of applied members);
  plays with no/different `tx` are *independent* (fan out concurrently under `p-queue`/
  `p-limit`, resumable in isolation). This is the dependency marker on top of `serial`/
  `strategy` (todo 12).
- **`checkpoint: <id>`** is a savepoint *inside* a transaction. On failure, unwind to the
  last reached checkpoint (partial rollback), not the whole tx. Author places them before
  risky steps; they double as **resume anchors** (`--resume <run_id>:<checkpoint>`).
- **Mechanics**: on member failure the orchestrator walks the tx's ledger rows in reverse,
  invoking each module's `undo` (where reversible). Per-device atomic commit (switches,
  todo 13) gives within-device rollback for free.
- **Honest caveat**: no true distributed ACID across heterogeneous targets (SSH+API+switch)
  — a `tx` is an *orchestration-level* guarantee (recorded ledger + best-effort inverse +
  converge-as-rollback via idempotency). A tx mixing reversible + side-effecting ops degrades
  to best-effort + operator-acknowledged; non-reversible ops are excluded from auto-rollback
  and listed in a pending-rollback report. Checkpoint placement is the author's
  responsibility (like SQL `SAVEPOINT`).

Status: **Designed (not yet built)** — rides on the todo 25 ledger + todo 13 device commit
+ intrinsic idempotency.

---

## 9. Proposed design: keeping idempotency the default (why users reach for shell, and how RoleCall avoids it)

Concrete answer to gap #9. Root causes (grounded in study's Lack-of-support 38.2% "write
your own module" + the general non-idempotency pain): (1) **coverage gaps** — no module for
the actual task (vendor API, kubectl/helm, cloud CLI, DB migration, new tech predating
modules); (2) **authoring friction** — a real Ansible module is heavy boilerplate, so shell
is the path of least resistance; (3) **discoverability** — users don't know `lineinfile`/
  `blockinfile`/`uri` exist; (4) **inspection gaps** — facts insufficient, so `grep`/`cat`
  to read state.

Two concrete designs:
- **A — batteries-included module picklist** (convenience layer): high-value modules that
  displace shell — a clean typed `http`/`rest` module (Ansible's `uri` is awkward),
  structured `edit` modules for json/yaml/ini/xml (kill `jq`/`sed`/`yq`), a proper
  `blockinfile`/`lineinfile`, an idempotent `sql`/migration module (kill `psql <<EOF`), and
  a generic `cli` wrapper that detects a command's `--dry-run` and declares idempotency.
- **B — `rolecall/module` idempotency helper lib for module authors (the scalable fix):** a tiny
  SDK so a custom module is trivially idempotent —
  ```ts
  import { resource, diff, dryRun } from "rolecall/module";
  export default resource({
    describe: async (ctx) => readCurrentState(ctx),   // what's there now
    converge: async (ctx, desired) => {
      const d = diff(current, desired);               // minimal delta
      if (dryRun(ctx)) return d;                      // --check just returns the diff
      applyDelta(ctx, d);
      return d;                                       // feeds todo 13 + todo 25 + §8 undo
    },
  });
  ```
  This attacks all four root causes: the picklist covers the 80% common cases; the helper
  lib makes the remaining 20% custom cases a ~5-line idempotent module instead of a shell
  one-liner. `converge()`'s returned diff feeds the diff engine (todo 13), the ledger
  (todo 25), and the undo path (§8) — so idempotency + tracing + rollback all fall out of
  one helper.

**Synthesis**: B is the scalable fix; A is the convenience layer; plus `rolecall modules search`
(discoverability, study rec #3) + a lint guard that warns on unguarded shell (no `creates`/
  `removes`/`changed_when` equivalent) and can block in CI, as the safety net for the
  truly-unavoidable shell. Maps directly to "write your own module" (38.2%).

**Caveat**: can't ban shell (escape hatch needed for uncovered tasks); goal is *nudge* —
  make idempotent the path of least resistance, make non-idempotent shell require an explicit
  guard.

Status: **Designed (not yet built)** — depends on todo 15 SDK + todo 13 diff engine +
todo 25 ledger.

---

## 10. Proposed design: clientless MCP surface over REST (agent contract + outside-harness)

Concrete answer to gap #10. Goal: make RoleCall trivially usable by any LLM agent *without*
shipping a separate MCP server, and keep the LLM harness outside RoleCall.

- **Reuse the orchestrator REST API (todo 18) as the agent surface — no separate MCP
  server binary.** RoleCall's `--serve` mode already exposes REST; extend it to be
  self-describing.
- **Discoverable manifest**: `GET /mcp` returns the full tool catalog as JSON-schema tool
  specs, **generated from the Zod schema (todo 3)** so it never drifts. Each spec names its
  REST method + path + params. The agent (or a tiny skill) fetches it once and has
  everything. A `rolecall agent manifest` subcommand emits the same spec for offline skill
  generation (CLI parity, todo 25) so a skill can be built without a running server.
- **Operations as REST** (already in the orchestrator): `facts.gather` → `POST /facts`;
  `playbook.run` → `POST /run`; `playbook.diff` → `POST /run` with `--check`;
  `run.replay` → `GET /runs/:id/trace` (+ `/profile`); `modules.search` → `GET /modules?q=`;
  `inventory.show` → `GET /inventory`; `run.status` → `GET /runs/:id/status`.
- **"Clientless"**: the transport is plain HTTP, so any LLM runtime calls it with stock HTTP
  — no MCP SDK/protocol, no extra process to run or version. A **simple LLM "skill"** is just
  a short file declaring the host + `GET /mcp`; it can even inline the tool specs (generated
  artifact) so the agent needs zero round-trips. This is the whole integration.
- **Why clientless over a dedicated MCP server**: avoids shipping/maintaining a second
  process; reuses the orchestrator RoleCall already builds; no version-skew between an MCP server
  and RoleCall core; smaller attack surface.
- **The contract the agent relies on** (RoleCall's guarantees): typed JSON + stable `run_id`
  (todo 18/21); typed errors (todo 8); `--check` bounded diff before apply (todo 5/13);
  RunTrace for observability (todo 25); idempotency metadata on modules (safe-to-retry
  signal); secrets never in output (todo 25 masking); schema-validated input fails closed
  (todo 3) so a bad agent call self-corrects from a named-field error.
- **Harness stays outside RoleCall**: users bring their own LLM + loop (Claude Agent SDK,
  LangChain, custom). RoleCall is the tool/skill provider. No `LlmProvider` trait, no `AiPlanner`
  inside RoleCall. Recommended guardrails for harness builders (check gate, approval, blast-radius,
  tx-wrap via todo 26, audit via todo 19) are documented as guidance, not RoleCall code. This
  drops the highest-risk embedded-LLM item and matches the plan's "Must NOT have" guardrails.

Status: **Designed (not yet built)** — depends on todo 3 (schema), todo 5/13 (check/diff),
todo 8 (typed errors), todo 18/21 (REST), todo 19 (store/audit), todo 24 (structured refs),
todo 25 (trace + masking), todo 26 (tx/checkpoint), todo 27 (module helper + search).

---

### Sources
- Carreira, Saavedra, Mendes, Ferreira (2026). *The Ultimate Configuration
  Management Tool? Lessons from a Mixed Methods Study of Ansible's Challenges.*
  EASE 2026. arXiv:2504.08678.
- UpGuard — *The Pros and Cons of Ansible* (2025).
- TechTarget — *Ansible limitations for network automation*.
- RoleCall repo: `README.md`, `architecture/connectivity.md`, `.omo/plans/rolecall.md`,
  `src/inventory/plugin.ts`, `src/transport/ssh.ts`.
