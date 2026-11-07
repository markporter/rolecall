---
title: Serve Command
---

The serve command starts the orchestrator HTTP server (`rolecall --serve`).

Serve mode works on both runtimes: it boots the durable SQLite store, which opens a runtime-selected synchronous sqlite handle through the PAL (`bun:sqlite` under Bun, `node:sqlite` under Node — ADR 0019). Under Node, `node:sqlite` prints a one-time `ExperimentalWarning` to stderr on first use; that is expected.

It boots a long-lived Express process described in `src/orchestrator/serve.ts`, listening on `127.0.0.1:8080` unless overridden. The HTTP surface itself is implemented and returns JSON throughout. The control plane is implemented too: run dispatch executes over real transports, project/schedule CRUD is persisted, a cron scheduler (`src/orchestrator/scheduler.ts`) arms enabled schedules and fires them through the engine, and Bearer-gated webhooks (`POST /webhook`, `POST /api/run`) enqueue runs. Each queued run is forked to the one-shot CLI (`rolecall playbook run -o jsonl`) with a materialized temporary playbook/inventory, so the full executor applies: roles, phases, `when`/`loop`, handlers, tx/checkpoint, modules, and `--check`/`--diff`/`--force`. Network simulator targets are reached through the simulator's HTTP `/cli` bridge, and the fork isolates resolver/facts/plugin globals across concurrent runs. The server serves a static UI directory when `--ui-dist` (or `--dist`) points at one; with no UI dist set, `GET /` returns a health JSON object.

Flags parsed for serve mode come straight from `serve.ts`:

| Flag | Env override | Default |
| --- | --- | --- |
| `--serve` | none | enters serve mode |
| `--port` / `--port=<N>` | `ROLECALL_SERVE_PORT` | `8080` |
| `--host` / `--host=<H>` | `ROLECALL_SERVE_HOST` | `127.0.0.1` |
| `--ui-dist <dir>` | `ROLECALL_UI_DIST` | unset |
| `--dist <dir>` | none | alias for `--ui-dist` |
| `--exposed` | `ROLECALL_SERVE_EXPOSED=1` | off |
| `--allow-anonymous` | none | off (test-only escape hatch) |

## Exposure and authentication

The default bind is loopback (`127.0.0.1`). A non-loopback bind is refused unless
both `--exposed` and a Bearer token are configured (`ROLECALL_SERVE_TOKEN`, or a
`rolecall.env` entry written by `rolecall install --exposed`). With `--exposed`,
every route except `GET /health` requires `Authorization: Bearer <token>`; the
comparison is constant-time. `--allow-anonymous` bypasses the token requirement for
tests only and prints an unsafe warning. A single shared token is a floor, not a
tenant boundary — see ADR 0027 for the full exposed profile.

When `--ui-dist` or `--dist` points at nothing, GET `/` returns a zero-build health JSON rather than trying to serve a missing SPA. Once a directory is supplied RoleCall serves it as the pluggable front end. Either way the startup log reports `rolecall --serve listening on http://<host>:<port> (pid <n>)` alongside the health and dispatch hints.

Endpoints defined in `src/orchestrator/routes.ts` and `webhooks.ts` return JSON throughout. Liveness lives at `GET /`, `GET /health`, and `GET /ping`. Status lands at `GET /status` with run totals plus project count. Run dispatch uses `POST /run` accepting `{"type":"playbook|adhoc|nonIdempotent", ...}` and echoes back `{runId,status:"queued",self:"/runs/:id/status"}`, which you poll via `GET /runs/:id/status`. Set `check: true` for an observe-only run: no target state is mutated, outcomes report would-change, and `diff: true` adds a candidate-vs-running diff for network targets. Projects expose CRUD at `/projects/:id` and schedules at `/schedules` plus `/schedules/:id`. Webhook-driven triggers sit at `POST /webhook` and `POST /api/run`, gated by an optional Bearer token (and by the token on every route in `--exposed` mode). The clientless agent surface also ships here: `GET /mcp` lists every registered tool spec, and individual tools fan out to their own routes — e.g. `modules.search` at `GET /modules`. The newest one, `docs.search`, reuses the shared markdown search over `docs/content/**/*.md` and is mounted at `GET /mcp/docs?q=`; it sits under `/mcp` on purpose so it never collides with `/docs`, which Swagger UI already occupies. These reuse the Zod schemas from `src/orchestrator/mcp.ts` and are validated identically to CLI handlers. Unknown paths return 404 JSON and wrong methods 405 JSON, never raw stack traces. See [/concepts/playbooks](/concepts/playbooks) for what a dispatched run represents.
