# Features

Detailed, status-tracked inventory of what RoleCall **does today** and what it
**intends to do**. For the high-level mission and product goals, see
[`goals.md`](goals.md); for the phased plan, see [`roadmap.md`](roadmap.md).

Status reflects `src/` reality and the `AGENTS.md` honesty rule. Scaffold items
are present in code but do **not** apply real remote state.

## Status legend

| Mark | Meaning |
|---|---|
| ✅ **Implemented** | Shipped and working in `src/`. |
| 🟡 **Scaffold** | Code present but not functional (Wave-0 scaffold). Does not apply real remote state. |
| ⏳ **Planned** | Explicit target capability, not yet built (see `goals.md` → Target capabilities). |
| 🚫 **Never** | Explicitly out of scope (see `goals.md` → Non-goals). |

## CLI

| Feature | Status | Notes |
|---|---|---|
| Single entrypoint + subcommand dispatch | ✅ | `src/cli/index.ts` `main()` |
| `rolecall --version` | ✅ | reads embedded `package.json` (single-file safe) |
| `rolecall playbook run` — planning | ✅ | parses, resolves inventory, emits dry-run plan |
| `rolecall playbook run` — execution | ✅ | resolves targets and applies tasks over SSH/local transports via `rolecall_connection` |
| `rolecall facts gather` | ✅ | gathers targeted/cached facts per resolved host; graceful on unreachable hosts |
| `rolecall inventory show` / `list` | ✅ | resolved hosts + per-host vars |
| `rolecall plugin list` | ✅ | merges registered module/fact plugins with built-in inventory plugins |
| `rolecall plugin register <name> --path <file>` | ✅ | persists a user module to `.rolecall/plugins.json` (project or global) and auto-loads it at startup |
| `rolecall docs search <query>` | ✅ | searches `docs/content/**`; CLI-queryable prose docs |
| `rolecall --serve` | ✅ | orchestrator server (stays bound; fixed in `25208bf`) |
| `rolecall vars list` | ✅ | lists every declared var grouped by declared-by file; shows layer + override status |
| `rolecall vars trace <name>` | ✅ | btool-style precedence trace of a var across all layers (role-default → extra-vars) with file/line provenance |

## Templating

| Feature | Status | Notes |
|---|---|---|
| Structured reference templating (`$var` / `$concat` / `$call` / `$if` / `$each` / `$template`) | ✅ | todo 24; `src/templating/refs.ts` |
| Facts reference (`$var: facts.key`) | ✅ | declared via `kind: fact` manifest or plugin/module `declares`; the `$fact` operator was removed in ADR 0013 |
| Typed `when` / `loop` | ✅ | todo 24 |
| Jinja-style `{{ }}` templating | 🟡 | kept literal (scaffold) |

## Run model & safety

| Feature | Status | Notes |
|---|---|---|
| Run tracing (RunTrace in SQLite) | ✅ | todo 25; `--trace` |
| Replay | ✅ | replay from the trace ledger |
| Failure locality | ✅ | typed error classes |
| Per-step profiling | ✅ | `--profile` |
| Transaction + checkpoint (rollback / resume) | ✅ | todo 26; `--resume <id>:<checkpoint>` |
| Executor (real remote execution) | ✅ | drives describe/converge live over a real Connection; proven by sim integration test |

## Idempotency & modules

| Feature | Status | Notes |
|---|---|---|
| Idempotency-by-default helper lib | ✅ | `rolecall/module` |
| Batteries-included modules | ✅ | picklist |
| `rolecall modules search` / `lint` | ✅ | todo 27 |
| Plugin SDK (`register` / `list` + auto-load) | ✅ | `plugin register` persists module plugins; startup auto-loads them into the executor |
| Project plugin scanning + FQCN module resolution | ✅ | `plugins/<type>/<ns>/` scanned at `playbook run`; dispatch by `<ns>.<name>` or unambiguous bare alias; builtins reserve bare names |
| Remote idempotent apply | ✅ | module `describe`/`converge` driven live by the executor |

## Agent surface (clientless, Zod-driven)

| Feature | Status | Notes |
|---|---|---|
| `GET /mcp` manifest | ✅ | todo 28 |
| Tool endpoints generated from Zod schemas | ✅ | dynamic — `/mcp` and `/docs.json` cannot drift |
| Dynamic `/docs.json` OpenAPI descriptor | ✅ | todo 28 |
| `GET /mcp/docs` documentation search | ✅ | `ecd3f47` |
| `docs.search` MCP tool | ✅ | `ecd3f47` |

## Orchestrator / server

| Feature | Status | Notes |
|---|---|---|
| Express orchestrator boot | ✅ | `--serve` |
| Route registry (scheduler / cron / webhooks / SPA UI) | 🟡 | accepts work but does not run it |
| SQLite store | ✅ | trace + state |
| SPA UI | 🟡 | scaffold; served but not a dependency of the default dist |

## Distribution

| Feature | Status | Notes |
|---|---|---|
| Dual-runtime (Bun / Node) PAL | ✅ | `detectRuntime()` |
| Single-file `bun build --compile` binary | ✅ | `bb7041a`; embedded docs + version |
| VitePress documentation site | ✅ | built from `docs/content` |
| Auto-generated API reference | ✅ | `documentation` skill |

## Transports

| Feature | Status | Notes |
|---|---|---|
| SSH (pure-JS, multiplexed) | ✅ | connect/exec over ssh2 against real hosts |
| Local | ✅ | exec via Bun.spawnSync against local processes |
| Network (SSH + CLI diff) | ✅ | connect/run over network SSH |
| HTTP / gRPC endpoints | 🟡 | connect/exec present; gRPC capability deferred |
| WinRM (Windows) | ⏳ | target capability (`goals.md`) |

## Facts (connection-driven, plugin/module-defined)

| Feature | Status | Notes |
|---|---|---|
| Targeted/cached fact gathering per host | ✅ | `FactsEngine` runs real gatherers over SSH/local/network/HTTP |
| Connection-type gatherer selection (`conn.kind`) | ✅ | mirrors Ansible `connection plugin` mechanism |
| Plugin/module-defined fact schemas (`declares` / `Module.facts`) | ✅ | registered into a global declared-fact registry |
| `facts` bridge into `var_strict` (`$var: facts.key`) | ✅ | declared fact set = registered producer set (no disconnect) |
| `rolecall vars trace` fact provenance | ✅ | documented under CLI above |

## Target capabilities (planned)

| Feature | Status | Notes |
|---|---|---|
| Vault / secret engine | ⏳ | `goals.md` target capability |
| GUI in core | ⏳ | promote the SPA to a first-class, core-shipped UI (`goals.md`) |

## Designed but not yet built (future)

| Feature | Status | Notes |
|---|---|---|
| Dynamic inventory plugin interface | 🟡 | partial (static + file/env built-ins) |
| WebSocket push for live run logs | ⏳ | `roadmap.md` |
| Multi-user RBAC (tower-like web access) | ⏳ | `roadmap.md` |
| Plugin marketplace | ⏳ | `roadmap.md` |
| Drift / compliance reporting | ⏳ | `roadmap.md` |
| Debugging observability (beyond error classes) | 🟡 | partial (`roadmap.md`) |
| Large-fact-set performance | ⏳ | `roadmap.md` |

## Explicitly never

| Feature | Status | Notes |
|---|---|---|
| Self-healing daemon loop | 🚫 | `goals.md` non-goals |
| Cloud IaC provider abstractions | 🚫 | `goals.md` non-goals |
