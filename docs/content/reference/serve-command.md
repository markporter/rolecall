---
title: Serve Command
---

The serve command starts the orchestrator HTTP server (`rolecall --serve`).

Serve mode works on both runtimes: it boots the durable SQLite store, which opens a runtime-selected synchronous sqlite handle through the PAL (`bun:sqlite` under Bun, `node:sqlite` under Node — ADR 0019). Under Node, `node:sqlite` prints a one-time `ExperimentalWarning` to stderr on first use; that is expected.

It boots a long-lived Express process described in `src/orchestrator/serve.ts`, listening on `127.0.0.1:8080` unless overridden. The HTTP surface itself is implemented and returns JSON throughout; the control-plane features layered on top — scheduled jobs, cron triggers, webhooks, and the SPA UI — remain scaffolded ('not yet implemented'), so treat those as planned rather than finished.

Flags parsed for serve mode come straight from `serve.ts`:

| Flag | Env override | Default |
| --- | --- | --- |
| `--serve` | none | enters serve mode |
| `--port` / `--port=<N>` | `ROLECALL_SERVE_PORT` | `8080` |
| `--host` / `--host=<H>` | `ROLECALL_SERVE_HOST` | `127.0.0.1` |
| `--ui-dist <dir>` | `ROLECALL_UI_DIST` | unset |
| `--dist <dir>` | none | alias for `--ui-dist` |

When `--ui-dist` or `--dist` points at nothing, GET `/` returns a zero-build health JSON rather than trying to serve a missing SPA. Once a directory is supplied RoleCall serves it as the pluggable front end. Either way the startup log reports `rolecall --serve listening on http://<host>:<port> (pid <n>)` alongside the health and dispatch hints.

Endpoints defined in `src/orchestrator/routes.ts` and `webhooks.ts` return JSON throughout. Liveness lives at `GET /`, `GET /health`, and `GET /ping`. Status lands at `GET /status` with run totals plus project count. Run dispatch uses `POST /run` accepting `{"type":"playbook|adhoc|nonIdempotent", ...}` and echoes back `{runId,status:"queued",self:"/runs/:id/status"}`, which you poll via `GET /runs/:id/status`. Projects expose CRUD at `/projects/:id` and schedules at `/schedules` plus `/schedules/:id`. Webhook-driven triggers sit at `POST /webhook` and `POST /api/run`, gated by an optional Bearer token. The clientless agent surface also ships here: `GET /mcp` lists every registered tool spec, and individual tools fan out to their own routes — e.g. `modules.search` at `GET /modules`. The newest one, `docs.search`, reuses the shared markdown search over `docs/content/**/*.md` and is mounted at `GET /mcp/docs?q=`; it sits under `/mcp` on purpose so it never collides with `/docs`, which Swagger UI already occupies. These reuse the Zod schemas from `src/orchestrator/mcp.ts` and are validated identically to CLI handlers. Unknown paths return 404 JSON and wrong methods 405 JSON, never raw stack traces. See [/concepts/playbooks](/concepts/playbooks) for what a dispatched run represents.
