# Roadmap

> Durable successor to `.local/mvp_summary.md`. Status reflects code through the
> latest committed work (docs-search `ecd3f47`, `--serve` fix `25208bf`, single-file
> binary `bb7041a`).

## Status summary
RoleCall today is an **honest MVP**: planning, modeling, structured templating, tracing,
transaction/checkpoint, idempotency-module library, and the clientless agent surface
are implemented and verified. The **execution half** — applying state to remote hosts
over SSH/local transports and collecting targeted/cached facts per host — is now also
implemented and verified (see below). What remains scaffolded and deferred is the
scheduler / cron / webhooks / SPA UI route registry, the richer plugin SDK authoring
surface (`plugin list`/`register` persistence + auto-load are implemented), the full
Jinja renderer (`{{ }}` stays literal), and the Postgres backend. The Node-runtime PAL
is implemented (npm channel = Node.js, ADR 0018); the durable SQLite store runs on
both runtimes over the PAL SqliteDb seam (ADR 0019 — drizzle-orm removed), so
`--serve`, `--trace`, `--profile`, and `run replay` work on Node too.

## Implemented (verified)
| Area | Where | Notes |
|---|---|---|
| Three-component unified binary | `src/cli`, `src/orchestrator` | one `rolecall` dispatches CLI + server |
| Config model & validation | `src/config/*` | Zod schemas; normalize/serialize helpers |
| CLI surface | `src/cli/*` | playbook run (--tags/--skip-tags), facts gather, inventory show/list (native + Ansible INI/YAML), plugin list/register, global flags |
| Ansible-compat play sugar | `src/config/schema.ts`, `src/config/loader.ts` | play-level `handlers:` (notify/flush) + `tags:` with `--tags`/`--skip-tags`; loader-level Ansible inventory detection (INI + `all:` YAML → native groups via `--inventory`) |
| Orchestrator server | `src/orchestrator/*` | Express + route registry + stores |
| Transport interfaces | `src/transport/*` | typed `Ssh/Local/Network/Http`; Ssh/Local/Network connect/run executed over real connections (Http gRPC deferred) |
| Execution over SSH/local | `src/cli/play.ts`, `src/cli/facts.ts`, `src/executor/*`, `src/cli/connections.ts` | resolves targets, builds connection per host (`rolecall_connection`), drives describe/converge live; facts gathered per host |
| Remote idempotent apply | `src/modules/*`, `src/executor/*` | module `describe`/`converge` driven live by executor; proven by sim integration test |
| Structured templating | `src/templating/*` | `$var`/`$concat`/`$call` + typed `when`/`loop` |
| Run trace + replay + profiling | `src/store/traces`, `src/cli/commands/run.ts` | `--trace`, `run replay`, `--profile` |
| Transaction + checkpoint | `src/executor/tx.ts` | rollback-via-undo; `--resume <id>:<checkpoint>` |
| Idempotency-by-default | `src/modules/*` | `resource`/`search`/`builtins`; `rolecall modules search`; lint |
| Clientless MCP surface | `src/orchestrator/mcp.ts`, `src/cli/commands/agent.ts` | `rolecall agent manifest`; `GET /mcp`; dynamic `/docs.json` |
| Docs search (CLI + REST) | `src/docs/search.ts`, `src/cli/commands/docs.ts` | `rolecall docs search`; `GET /mcp/docs` |
| `--serve` stays bound | `src/orchestrator/serve.ts` | fix `25208bf`: block until signal |
| Single-file binary | `scripts/embed-docs.ts`, `src/docs/embedded-content.ts` | `bun run compile` → embedded docs+version |
| Node.js npm channel | `scripts/build-js.mjs`, `lib/cli.js` | `bun build --target=node --packages=external` via non-entry shim (ADR 0018); `prepack` auto-builds; Node PAL real for sqlite/crypto/dns/spawn/file/http/observability |
| API reference + VitePress + OpenAPI | `docs/` | TypeDoc + VitePress + route-synced OpenAPI |

## Scaffolded / deferred (designed, typed, "not yet implemented")
- **Real Jinja rendering**: `{{ }}` preserved verbatim until a renderer lands. Structured `$var`/`$concat`/`$call` + typed `when`/`loop` ARE implemented.
- **Postgres backend**: record-only store; SQLite is the implemented persistence layer, now dual-runtime over the PAL SqliteDb seam (ADR 0019). The narrow `Store`/`TracesRepository` interface is the future Postgres seam.
- **Plugin SDK**: `plugin list`/`register` are implemented (persist + auto-load user module/fact plugins — see ADR 0016); the richer authoring/test harness is deferred.
- **Scheduler / cron / webhooks / SPA UI**: route registry accepts work but does not run it.
- **RBAC / Vault secret engine / WinRM**: target capabilities, not built.

## Deferred-but-designed (future)
- Full plugin marketplace, multi-user RBAC for tower-like web access, WebSocket push for live run logs.
- Evidence-based gap analysis (secrets, Windows/WinRM, debugging observability, templating
  boundary, rollback/resume, drift reporting) is tracked in
  [`ansible-comparison.md`](ansible-comparison.md) §4; several of these are designed-but-not-built.

## Non-goals (things RoleCall will never do)
No self-healing daemon loop, no cloud IaC provider abstractions. (Vault/secret
engine, WinRM transport, and GUI-in-core are now target capabilities — see
`goals.md` — not exclusions.)

## Milestone references
- Baseline `63a38a5`; TSDoc `706945c`; docs boulder `8390f87`
- Todos 24–27 `09e671f`; Todo 28 `15a6d2e`
- Docs-search `ecd3f47`; `--serve` fix `25208bf`; single-file binary `bb7041a`
