# Goals

## Mission
RoleCall is a **clientless, push-style configuration-management and orchestration CLI**
plus an orchestrator server — built to be a **better Ansible**. It targets Linux/Unix
hosts (SSH), network switches/appliances (SSH+CLI diff), generic HTTP/gRPC API
endpoints, and — optionally — a transient/permanent agent on capable platforms. It is
**Bun-first** with a dual-runtime design (Bun or Node via `detectRuntime()`), and
optimized for fast authoring in JS/TS rather than Python/YAML.

## In scope (what RoleCall is)
For the specific, status-tracked feature inventory, see [`features.md`](features.md).

- A single entrypoint (`rolecall`) dispatching CLI subcommands and `--serve` orchestrator.
- Planning: parse/normalize config (Zod), resolve inventory, emit a dry-run plan.
- Structured reference templating (`$var`/`$concat`/`$call` + typed `when`/`loop`).
- Run tracing, replay, failure-locality, and per-step profiling.
- Transaction + checkpoint model (rollback-via-undo; `--resume <id>:<checkpoint>`).
- Idempotency-by-default module library + batteries-included modules.
- A clientless, **discoverable** agent surface: `GET /mcp` manifest + tool endpoints
  generated from Zod schemas, plus a dynamic `/docs.json` OpenAPI descriptor.
- CLI- and REST-queryable prose docs (`rolecall docs search`, `GET /mcp/docs`).
- A true single-file distributable via `bun build --compile` with embedded docs+version.

## Target capabilities (planned — not yet implemented)
These are explicit goals for the whole RoleCall product, distinct from what ships
today. They are tracked here so the roadmap and architecture can plan for them;
none are implemented yet (per the honesty principle, scaffold ≠ functional).

- **ProjectSource VFS (git/S3 deferred):** playbooks, inventory, and user modules
  (`module: ./path`) resolvable from local disk, a git repo, or object storage through
  one `ProjectSource` interface (`src/vfs/project-source.ts`). Local-disk reading already
  works today (`FsProjectSource`); resolving from git (`ROLECALL_PROJECT_GIT_URL`,
  `GitProjectSource`) or an object store (`S3ProjectSource`) is designed-in and deferred.
  See [`vfs-and-io-abstractions.md`](vfs-and-io-abstractions.md) and [ADR 0004](decisions/0004-serverless-and-git-friendly.md).
- **Scratch/temp VFS (memory + fs now; S3 deferred):** temporary artifacts written to a
  key/value scratch space selected by `ROLECALL_SCRATCH` (`src/vfs/scratch.ts`). Memory and
  local-disk backends exist now (`MemoryScratchStore`, `FsScratchStore`); storing on an
  object store (`S3ScratchStore`) is reserved/designed-in and deferred.
- **Postgres state store (deferred, local SQLite by default):** durable runs/traces/schedules persisted on shared PostgreSQL behind the DbConn seam, selected via env only (`ROLECALL_DB_URL` for auto-detect with safe fallback to a colocalized per-project `.rolecall/state.db`, or strict `ROLECALL_DB_BACKEND=postgres` that fails loud instead of falling back). Per-project SQLite stays the default so a laptop still gets its own registry; no CLI surface is added. See [ADR 0006](decisions/0006-storage-backend-colocation-and-postgres.md) and [`vfs-and-io-abstractions.md`](vfs-and-io-abstractions.md).
- **Project layout + RoleCall-native collections (design captured in ADR 0014/0015):** a RoleCall project exposes local `modules/` and local `roles/`; a dependency is simply another RoleCall project (the "everything is a project" model), reused via `collections.yml` + git-first `rolecall collections install` — no npm and no `node_modules` graph. Roles are themselves full RoleCall projects. Scaffold tooling (`--create-project`) and the collections resolver are planned; no execution surface yet. See [ADR 0014](decisions/0014-project-and-plugin-architecture.md) (architecture) and [ADR 0015](decisions/0015-collections-and-install-commands.md) (collections & install).
- **Vault / secret engine** — first-class secrets management: a vault-reference
  resolution layer + secret injection that **never renders secrets into
  logs/stdout**. The design rationale lives in
  [`ansible-comparison.md`](ansible-comparison.md) §4.
- **WinRM transport (Windows)** — first-class Windows host support via
  `winrm-client` (or a `pywinrm` sidecar) behind the existing `Connection`
  trait; see [`architecture/connectivity.md`](architecture/connectivity.md).
- **GUI in core** — promote the SPA UI scaffold to a first-class, core-shipped
  graphical interface. The orchestrator already serves it; it becomes a
  dependency of the default distribution rather than an optional extra.

## Non-goals (things RoleCall will never do)
- No self-healing daemon loop.
- No cloud IaC provider abstractions.

## Ansible-inspired design (complaint-driven)
RoleCall's design is explicitly framed against Ansible's documented pain points. A
mixed-methods study (Carreira et al., EASE 2026, arXiv:2504.08678 — 59,157 posts +
20 practitioner interviews), corroborated by UpGuard, TechTarget, and InfoWorld,
ranks the heaviest Ansible complaints: templating/YAML escaping, painful Python
module authoring, statelessness, SSH/scale limits, weak failure locality, and
AWX/Tower friction. RoleCall answers them with: fast compiled templating + escapeless
structured references; a first-class JS/TS plugin SDK; idempotency intrinsic to the
module contract; pure-JS multiplexed SSH on Bun with bounded fan-out; RunTrace-based
failure locality + profiling; and a built-in Express orchestrator.

The study's four recommended improvements guide RoleCall's priorities:
1. **Stronger failure locality** → RunTrace + replay + typed error classes.
2. **Clearer language/templating boundary** → structured `$var`/`$concat`/`$call` refs + typed `when`/`loop`.
3. **Targeted documentation** → this `design/` folder + the VitePress guide.
4. **Better execution backends** → resilient runner (retry/timeout/concurrency) + bounded fan-out.

> **Status:** the `ansible-comparison.md` §4 gaps for **secrets management** and
> **Windows/WinRM** are no longer out of scope — they are now explicit target
> capabilities above (vault/secret engine, WinRM transport). The GUI-in-core goal
> likewise resolves the earlier "UI optional" posture. The remaining non-goals
> (self-healing daemon, cloud IaC) are things RoleCall will *never* do. Full evidence
> and the gap analysis remain in
> [`ansible-comparison.md`](ansible-comparison.md) (detailed) and
> [`ansible-challenges-summary.md`](ansible-challenges-summary.md) (concise).

## Design principles
1. **Honesty** — Wave-0 scaffolds are labeled "not yet implemented"; never claim
   scaffold as functional (see `AGENTS.md`).
2. **Dual-runtime** — code must work under both Bun and Node PALs (`detectRuntime()`).
3. **Clientless-first** — push config over outbound SSH/HTTP; no target-side state by default.
4. **Discoverable agent interface** — the agent surface is derived from Zod schemas,
   so `/mcp` and `/docs.json` cannot drift from the actual routes.
5. **Idempotency-by-default** — modules expose `describe`/`converge`; convergence is
   the contract, not side-effecting scripts.
6. **Source of truth is `src/`** — `README.md`'s status banner is broad; trust `src/`
   and document what it *really* does.
7. **Docs-sync on change** — any public-export/signature/behavior change triggers the
   `documentation` skill to regenerate API reference, VitePress, and the OpenAPI module.
