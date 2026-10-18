# 0003 — Agent surface derived from Zod schemas

- Status: **Accepted**
- Date: 2026-09-18

## Context
RoleCall exposes a clientless agent interface (`GET /mcp` manifest + tool endpoints and a
`/docs.json` OpenAPI descriptor). Hand-maintaining these alongside the Express route
registry risks drift — the docs would lie about what the server actually does.

## Decision
- Tool specs live once in `TOOL_DEFS` (each with a Zod `inputSchema`); `buildManifest()`
  renders the manifest by converting Zod → JSON Schema. Tool endpoints validate input via
  `validateToolInput(name, body)`.
- `GET /docs.json` is generated **at runtime** from `ROUTE_DEFINITIONS`
  (`docs.ts` → `buildOpenApi()`), so it always reflects the mounted routes.
- Prose docs are queryable via `rolecall docs search` / `GET /mcp/docs`, backed by embedded
  `docs/content/**/*.md`.

## Consequences
- The agent surface cannot drift from the code: one schema source of truth.
- Added a search endpoint and CLI command (commits around `ecd3f47`).
- Agents discover tooling without scraping source: `rolecall agent manifest` or `GET /mcp`.
