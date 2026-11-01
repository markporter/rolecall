# Data Flows

## `playbook run` (current)
1. CLI parses flags → `parseArgs`.
2. Playbook + inventory normalized via Zod (`src/config`).
3. Inventory resolved → hosts + per-host vars.
4. Resolved hosts drive tasks through the executor over a real `Connection` per target
   (ssh/local/network, chosen via `rolecall_connection`). `--check` observes and reports
   would-change without converging (unsupported modules are skipped), `--diff` attaches an
   observed-vs-desired patch, and `--force` bypasses idempotency skips.
5. Traces are recorded per step during application; replay/resume/profiling read them back from store.

## `--serve`
1. `main()` detects `--serve` → dynamic-imports orchestrator → `startServe(argv)`.
2. `createServer()` builds the Express app, mounts `ROUTE_DEFINITIONS`, registers signal handlers.
3. `POST /run`, cron, and webhooks enqueue a job; the engine materializes a temp playbook/inventory and forks `rolecall playbook run -o jsonl`, parsing typed events + the final result. The child gets fresh resolver/facts/module state, so the full executor (roles, phases, `when`/`loop`, handlers, tx, check/diff/force) applies.
4. `startServe` blocks (never resolves) until SIGINT/SIGTERM; `settle()` drains, closes store, exits.
5. With `--ui-dist`, static SPA is served; otherwise `GET /` returns health JSON.

## Clientless MCP / agent surface
- `GET /mcp` → `buildManifest()` renders tool specs from `TOOL_DEFS` (Zod `inputSchema` → JSON Schema).
- Tool endpoints call `validateToolInput(name, body)` then the handler.
- `GET /docs.json` is generated **dynamically** from `ROUTE_DEFINITIONS` at runtime, so it cannot drift.
- `GET /mcp/docs?q=` → `searchDocs()` over embedded docs → `{command,query,count,hits}`.

## Trace / replay / resume
- `TracesRepository` records per-step entries during a run (`--trace`).
- `rolecall run replay <id>` re-reads the store and re-emits the ledger.
- `--resume <run_id>:<checkpoint>` → `parseResumeArg()` + `computeResumeSkipSet()` skip converged steps.
- `--profile` emits per-step timings exposed at `/runs/:id/trace` and `/runs/:id/profile`.
