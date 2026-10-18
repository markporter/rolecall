# RoleCall — Design

This folder is the durable home for RoleCall's **goals, architecture, roadmap, and
architecture decision records (ADRs)**. It is the "why" and "where-to" — distinct
from:

- `docs/` — the *published* VitePress site (user-facing guide + API reference).
- `AGENTS.md` — operational guidance for agents (how to *use* vs *code* RoleCall).
- `.omo/` — internal task/boulder tracking (working artifact, not durable).
- `.local/` — scratch status notes (e.g. `mvp_summary.md`); superseded by `roadmap.md`.

Files here are plain Markdown (no build step) so both humans and agents can read
them directly.

## Map

| File | Purpose |
|---|---|
| `goals.md` | Mission, scope, target capabilities, non-goals (never), design principles |
| `features.md` | Status-tracked feature inventory (implemented / scaffold / planned / never) |
| `roadmap.md` | Phased Wave 0→N plan; what's implemented vs scaffolded/deferred |
| `serverless-and-git-friendly.md` | Target capabilities + phased plan for git-backed projects & serverless deploys (ADR 0004) |
| `vfs-and-io-abstractions.md` | Backend matrix for the three IO seams (ProjectSource / DbConn / ScratchVfs): implemented-now vs planned cross-linked to ADR 0004 |
| `architecture/overview.md` | Component boundaries and how they fit together |
| `architecture/data-flow.md` | Key request/control flows (playbook run, serve, MCP, trace/replay) |
| `architecture/connectivity.md` | Transport-layer design (SSH/network/HTTP/WinRM/agent) — migrated brief |
| `architecture/facts.md` | Facts & connection-driven gathering: `conn.kind` selects gatherers; plugin/module-defined facts; bridge to `var_strict` |
| `ansible-comparison.md` | Full complaint-driven comparison of RoleCall vs Ansible (evidence-based) |
| `ansible-challenges-summary.md` | Concise version of the RoleCall-vs-Ansible comparison |
| `ansible-compatibility-roadmap.md` | Execution plan for ADR 0009: Wave 1–3 work items closing every (U)/(P)/(X) gap, with all open decisions D1–D6 resolved |
| `usecases.md` | Use cases enabled/targeted by RoleCall's design choices (marketing source) |
| `decisions/` | Numbered ADRs (append-only; see `0001-...` for the convention); latest include `0004-serverless-and-git-friendly`, `0005-io-abstractions-vfs-db-scratch`, `0006-storage-backend-colocation-and-postgres`, `0008-literal-by-default-templating`, `0009-ansible-compatibility-and-mechanical-conversion` (Ansible-compatibility mandate), and `0010-fact-gathering-connection-driven-and-plugin-defined` (connection-kind gatherer selection + plugin/module-owned facts), `0012-shell-run-mode` (collapse guarded/changed_when/intentional into a single `run_mode` enum), and `0013-explicit-variable-namespacing` (single `$var` operator with fully-qualified `namespace.key` paths and no auto-prefix; reserved scoped keys `vars`/`facts`/`reg`/`loop`/`play`/`inv`/`role`/`run`/`rolecall`; `loop` holds `item`/`index`, `play` holds play/host context (replaces bare `host`), `inv` exposes source-attributed inventory, `role` holds role context, `run` holds run-scoped metadata (paths, limit/forks), `rolecall` is platform-only; removes `$fact`; retires the top-level `register:` spread and the `unprefixed-var` lint), and `0014-project-and-plugin-architecture` (folder-projects, JIT bundle-or-node_modules, FQCN-from-path), and `0015-collections-and-install-commands` (RoleCall-native dependency distribution; `rolecall install`=central runtime vs `rolecall collections install`=project hydration), and `0016-plugin-and-module-sdk-authoring-surface` (plugin/module SDK authoring surface: implemented module/plugin contract vs scaffolded authoring tooling), and `0017-execution-isolation-and-run-scope` (per-run dependency-injected run scope + fork-per-run playbook execution for `--serve`), and `0018-dual-runtime-distribution-npm-node-binaries-bun` (npm channel = Node.js via `lib/cli.js` bundle; binaries = Bun; createRequire-only laziness rule; engines floor), and `0019-store-over-pal-sqlite-drop-drizzle` (durable store rewritten over the PAL SqliteDb seam — runtime-selected bun:sqlite/node:sqlite, `BEGIN IMMEDIATE` read-modify-write fencing, drizzle-orm removed; nothing user-facing is Bun-only anymore; the `Store` interface is the future Postgres seam) |
| `decisions/superseded/` | **Retired ADRs** (preserved for history only — do not use for new work; see `decisions/superseded/README.md`): `0007-project-layout-and-npm-distribution` (npm-distributed modules/roles — replaced by ADR 0014/0015), `0011-module-and-plugin-namespacing` (module/plugin namespacing — replaced by ADR 0014). |
| `conventions.md` | Contributor + agent conventions; cross-links `AGENTS.md` |

## Status

Current code is a faithful, honest **MVP**: it plans, introspects, executes, and
applies state to remote hosts over SSH/local transports, exposing a discoverable,
clientless agent interface. Scheduler / cron / webhooks / SPA UI route registry, the
richer plugin SDK authoring surface, the full Jinja `{{ }}` renderer, and the Postgres
backend remain scaffolded. The Node-runtime PAL is implemented (npm channel = Node.js;
see ADR 0018); the durable SQLite store runs on both runtimes over the PAL SqliteDb
seam (ADR 0019 — drizzle-orm removed), so `--serve`, `--trace`, `--profile`, and
`run replay` work on Node too. Postgres stays the future enterprise backend
(scaffolded). See `roadmap.md` for the precise implemented/scaffold split.
