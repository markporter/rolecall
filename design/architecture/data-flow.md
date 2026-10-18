# Data Flows

## `playbook run` (current)
1. CLI parses flags → `parseArgs`.
2. Playbook + inventory normalized via Zod (`src/config`).
3. Inventory resolved → hosts + per-host vars.
4. Resolved hosts drive tasks through the executor over a real `Connection` per target (ssh/local/\n   network, chosen via `rolecall_connection`); compute-only flags (`--check`/`--diff`/`--force`)\n   shape real convergence rather than merely printing a plan.
5. Traces are recorded per step during application; replay/resume/profiling read them back from store.

## `--serve`
1. `main()` detects `--serve` → dynamic-imports orchestrator → `startServe(argv)`.
2. `createServer()` builds the Express app, mounts `ROUTE_DEFINITIONS`, registers signal handlers.
3. `startServe` blocks (never resolves) until SIGINT/SIGTERM; `settle()` drains, closes store, exits.
4. With `--ui-dist`, static SPA is served; otherwise `GET /` returns health JSON.

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
