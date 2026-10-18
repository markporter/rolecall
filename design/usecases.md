# RoleCall Use Cases

> **Source material for product / marketing.** Maps each use case to the concrete
> design choice that enables it, with an honest status tag so messaging stays
> truthful. This is the raw material — benefit-led copy can be derived from it.

**Status legend:** 🟢 Shipped · 🟡 Designed (in plan, not yet built) · ⚪ Planned (target capability)

**Honesty note:** RoleCall's MVP ships the *planning, introspection, and transport*
layers. RoleCall now also executes live: `playbook run` applies state over SSH/local transports and
`facts gather` gathers targeted/cached facts per host. Use cases below describe what the
design *targets*; items not marked 🟢 remain roadmap or target capabilities.
(Per `AGENTS.md`: scheduler/cron/webhooks/UI, the plugin SDK authoring surface, literal
Jinja rendering, and the Postgres backend stay genuinely scaffolded; the durable store
runs on both runtimes over the PAL SqliteDb seam — ADR 0019.)

## Why these use cases

RoleCall is a Bun-first Ansible alternative — one executable with a CLI mode
(`rolecall playbook run`) and an orchestrator mode (`rolecall --serve`). Its design choices
were made specifically to answer the pain points documented in the mixed-methods
study of Ansible (Carreira et al., EASE 2026, arXiv:2504.08678): templating /
escaping hell, no failure locality, weak debugging, and an agentless model that
doesn't scale. Each use case below is a direct consequence of a deliberate design
decision, not a bolt-on.

## Use cases

### 1. Safe, drift-free automation without shell hacks
- **Enabling design:** Idempotency is *intrinsic* to the module contract — there is
  no `idempotent: false` escape hatch. On top of that, `rolecall/module` ships a
  `resource({ describe, converge })` helper that returns a diff, plus a
  batteries-included module picklist (http/rest, json/yaml/ini/xml edit,
  blockinfile/lineinfile, sql/migration, cli-wrapper) and a `rolecall modules search` +
  lint guard that steers users away from raw `shell`.
- **Status:** 🟡 Designed (todo 27). Core contract is designed and applied through the live executor; further refinement stays scoped to todo 27.
- **Angle:** "Stop reaching for shell. RoleCall makes the idempotent path the easy path."

### 2. Crash-safe, all-or-nothing multi-step changes
- **Enabling design:** A `tx_id` marks a set of plays as both a *dependency group*
  and a *rollback boundary*; a `checkpoint_id` acts as a savepoint (partial
  rollback) and a resume anchor. A change ledger records every delta with its
  inverse, so a failed run rolls back to the last checkpoint. No distributed ACID
  — orchestration-level best-effort plus "converge as rollback."
- **Status:** 🟡 Designed (todo 26).
- **Angle:** "A playbook run is a transaction. Crash mid-way? Resume or roll back to
  the last good checkpoint — no half-applied drift."

### 3. No templating or YAML-escaping hell
- **Enabling design:** Structured reference nodes (`$var`, `$concat`, `$call`) move
  templating out of scalar strings and into the data tree, killing the
  template-layer `{{ }}` / `|` / `%` escaping entirely. Control flow
  (`when` / `loop` / `serial`) is typed *structured* fields, not templated
  strings. A TypeScript authoring escape hatch covers the rare complex case.
- **Status:** 🟡 Designed (todo 24).
- **Angle:** "The three nested interpreters problem (YAML → Jinja → shell) is gone.
  Templates live in the data tree, not buried in quoted strings."

### 4. Debuggable, profilable runs
- **Enabling design:** `RunTrace` persists per-run / host / task / phase timings
  (connect / render / exec / diff / facts / fan-out) in SQLite — which doubles as a
  profiler that answers *why is this slow*. Failure-locality snapshots show exactly
  where a run broke. Surfaced via `--trace` / `--profile` / `--replay` and
  `/runs/:id/trace`.
- **Status:** 🟡 Designed (todo 25). Persists in *both* CLI and `--serve` modes to
  the shared `~/.rolecall` store.
- **Angle:** "Ansible tells you a task failed. RoleCall tells you *which phase* took 40s
  and *why* — and lets you replay it."

### 5. Agent / LLM-native control plane
- **Enabling design:** *Clientless* REST/MCP — the orchestrator's REST surface *is*
  the agent surface; a discoverable `GET /mcp` manifest is derived from the Zod
  schemas; a plain-HTTP client (no separate MCP server to run) is all an agent
  needs. Typed errors + JSON output + `--check` diffs make RoleCall legible to
  autonomous agents. The harness lives *outside* RoleCall.
- **Status:** 🟡 Designed (todo 28).
- **Angle:** "ROLECALL_AI-ready: a single skill file is enough for an LLM agent to plan,
  dry-run, and operate your fleet."

### 6. Serverless, git-friendly, stateless
- **Enabling design:** 12-factor `loadConfig()` (env / `.env`); `ProjectSource` VFS
  (git / S3-backed project + user modules); dialect-agnostic `DbConn` (Postgres
  alongside SQLite behind the `Store` interface, ADR 0019); `ScratchVfs`
  (fs / memory / s3); one-shot serverless mode (boot → handle → exit).
- **Status:** ⚪ Planned (ADR 0004, *Proposed*; Postgres / Git / S3 backends
  deferred — the seam is designed, the backends are not built).
- **Deployment shapes it unlocks:**
  - **AWS Lambda** — one-shot run, source from git, state in RDS Postgres; pairs
    with Step Functions + tx/resume for runs past the 15-min limit. `--serve` does
    *not* fit Lambda.
  - **Docker / Kubernetes** — `--serve` as a Deployment; Postgres for multi-replica
    (SQLite cannot); SSH works fine; no timeout pressure.
  - **Sidecar** — co-located agent in the app pod; localhost REST/MCP control plane;
    shared volume for managed files; idempotent re-converge on restart.
- **Angle:** "Run RoleCall where there is no disk: CI, Lambda, Cloud Run, or as a
  sidecar next to the workload it manages."

### 7. Secure-by-default transport
- **Enabling design:** Pure-JS `ssh2` (no libssh2 → no CVE-2026-55200), channel
  multiplexing + keepalive, known-hosts host-key verification, and a resilient
  runner (retry / timeout / concurrency).
- **Status:** 🟢 Shipped (`src/transport/ssh.ts`).
- **Angle:** "No native CVE surface. SSH that survives flaky networks."

### 8. Zero-friction distribution
- **Enabling design:** Single-file native binary via `bun build --compile`
  (ADR 0002); Bun-first with a Node fallback (`detectRuntime`); docs and version
  embedded in the binary.
- **Status:** 🟢 Shipped (binary + multi-runtime).
- **Angle:** "One binary. No Python, no pip, no agent to pre-install."

### 9. CI / pipeline-native
- **Enabling design:** The one-shot CLI (not `--serve`) maps directly to a CI job's
  run-once-then-exit shape; the single-file binary (ADR 0002) drops into any image
  with no Python/pip; `--check` / `--diff` dry-run plus `-o json` give a
  machine-readable PR gate; idempotency-by-default makes re-runs safe; 12-factor
  `loadConfig` consumes CI-injected env; and the repo is already on disk in CI, so
  the default `FsProjectSource` works without the deferred git-backed backend.
  `RunTrace` / `--profile` (todo 25) surfaces slow/failed phases in build logs.
- **Status:** 🟢 Shipped as a *validation / planning gate* (binary, one-shot CLI,
  `--check` / `--diff`, JSON output all exist today) AND as a *live applier* —
  `playbook run` drives tasks over SSH/local transports through its built connection.
  Gated pieces here remain scheduled/webhook-driven automation and the git-backed project source.
- **Angle:** "Drop one binary in the pipeline. Gate merges on `rolecall playbook run
  --check -o json`; apply on merge. No venv, no agent, no drift."

## Use-case → design-choice matrix

| # | Use case | Enabling design | Status |
|---|----------|-----------------|--------|
| 1 | Drift-free automation, no shell hacks | Intrinsic idempotency + `rolecall/module` helper + picklist + lint guard | 🟡 Designed |
| 2 | Crash-safe all-or-nothing changes | `tx_id` / `checkpoint_id` + change ledger + resume | 🟡 Designed |
| 3 | No templating / escaping hell | Structured reference nodes + typed control flow | 🟡 Designed |
| 4 | Debuggable, profilable runs | `RunTrace` (per-phase timings + failure locality + replay) | 🟡 Designed |
| 5 | Agent / LLM-native control | Clientless REST/MCP + Zod manifest + typed errors | 🟡 Designed |
| 6 | Serverless / git-friendly / stateless | VFS + Postgres + 12-factor + one-shot mode | ⚪ Planned |
| 7 | Secure transport | Pure-JS `ssh2`, host-key verification, resilient runner | 🟢 Shipped |
| 8 | Zero-friction distribution | Single-file binary + multi-runtime + embedded docs | 🟢 Shipped |
| 9 | CI / pipeline-native (validation gate now, applier pending) | One-shot CLI + single-file binary + --check/--diff + JSON + idempotency | 🟢 Shipped (gate) / 🟡 Designed (apply) |

## Note for marketing

This doc is the honest source. Lead with the *designed differentiators*
(idempotency-by-default, transaction/checkpoint, no escaping hell, debuggable
runs, agent-native, serverless) and pair each with its status so GA messaging
stays truthful. The executor completion is the gate to "end-to-end functional"
for cases 1–5. Cases 7–8 are shippable today.
