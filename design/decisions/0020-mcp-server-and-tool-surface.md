# 0020 — MCP server and tool surface

- Status: **Proposed**
- Date: 2026-10-18
- Related: [ADR 0003](0003-zod-driven-agent-surface.md) (schemas drive the agent surface; extended here, not retired), [ADR 0017](0017-execution-isolation-and-run-scope.md) (fork-per-run execution that serve-mode MCP runs depend on), [ADR 0018](0018-dual-runtime-distribution-npm-node-binaries-bun.md) (dual-runtime distribution and the createRequire laziness rule), [ADR 0014](0014-project-and-plugin-architecture.md) (project layout behind the VFS seam)

## Context

RoleCall's agent surface is deliberately clientless. `src/orchestrator/mcp.ts` opens with
"there is NO separate MCP server binary", and `design/ansible-comparison.md` §10 argued
against a dedicated MCP server: a second process, version skew, a bigger attack
surface. That stance produced the `TOOL_DEFS` registry (8 tools), `buildManifest()`,
`GET /mcp`, and `rolecall agent manifest`: a REST catalog any LLM runtime can drive
with stock HTTP.

Two things have changed since. MCP has become the default wire protocol agent harnesses
speak: Claude Desktop, Claude Code, Cursor, and similar clients discover and call tools
over JSON-RPC 2.0 natively, with progress notifications and streaming built in. The
clientless surface still works, but every MCP-native harness needs bespoke glue that
RoleCall could ship once, itself: a skill file, manifest polling, hand-rolled REST
calls. And the catalog is incomplete for real agent workflows: there are no authoring
tools at all, and the run tools ride the scaffolded orchestrator path. `POST /run` in
`src/orchestrator/routes.ts` and the `playbook.run` / `facts.gather` descriptions in
`src/orchestrator/mcp.ts` carry `TODO(ROLECALL-PLACEHOLDER): Wave-0 scaffold` markers
stating they dispatch into the local run map only and do not perform real remote state.
This ADR proposes a real MCP protocol server as an additional adapter over the same
registry, with a tool catalog covering authoring and run/debug, executing through the
same executor pipeline the CLI uses.

## Decision

### 1. Ship a real MCP server as a new adapter, not a replacement

RoleCall gains an MCP protocol server speaking JSON-RPC 2.0 per the MCP spec: an adapter
over the existing registry, not a new surface. The clientless REST catalog (`GET /mcp`
plus the REST tool endpoints) and the CLI stay as they are. This **revises** the "no
dedicated MCP server" stance of ADR 0003's context and `design/ansible-comparison.md`
§10; the reasons given there (a second process, version skew) are mitigated by §2 (one
registry) and §8 (one dependency, bundled). ADR 0003 is NOT retired: its core decision,
that schemas drive the surface so it cannot drift, still stands and is extended to MCP.

### 2. Single source of truth: the existing `TOOL_DEFS` registry

MCP tool definitions derive from `TOOL_DEFS` in `src/orchestrator/mcp.ts`, extended with
the new tools below. `buildManifest()` renders them for REST discovery, and the MCP
server lists the same defs over `tools/list`; inputs are validated by
`validateToolInput()` (Zod, fail-closed with named-field errors). The MCP server and the
REST manifest therefore cannot drift, which is the ADR 0003 principle applied to a second
protocol. Where a tool carries config data, its Zod schema reuses the canonical
`PlaybookSchema` / `InventorySchema` from `src/config/schema.ts`. Each def keeps its
`rest` routing metadata; new HTTP counterparts are added to `ROUTE_DEFINITIONS` in the
same change so `GET /docs.json` stays honest.

### 3. Transports: stdio and streamable HTTP, with a path scheme

- **stdio** is the primary local-agent integration, surfaced as a proposed new
  `rolecall mcp` subcommand (must be added to `GLOBAL_OPTS`/HELP in `src/cli/index.ts`;
  a work item, not part of this ADR). A harness spawns `rolecall mcp` and speaks MCP
  over stdin/stdout, with no server process to run.
- **Streamable HTTP** mounts on the existing `rolecall --serve` orchestrator
  (`src/orchestrator/serve.ts`), so a shared team server exposes the same catalog.

Naming collision, resolved explicitly: `GET /mcp` already returns the REST tool manifest,
while MCP's HTTP transport is JSON-RPC `POST`. The scheme: keep `GET /mcp` as the
human/HTTP REST manifest it is today, and mount the MCP JSON-RPC endpoint at a distinct
path, `/mcp/v1`, honoring the `MCP-Protocol-Version` and `MCP-Session-Id` header
conventions from the MCP spec. The collision is also flagged in Consequences.

### 4. Tool catalog: two families

**Authoring (create/update projects and playbooks):**

- `project.create`, `project.update`, `project.get`, `project.list`: new tools wrapping
  the store-backed projects routes the orchestrator already mounts
  (`POST|GET /projects`, `PUT|DELETE /projects/:id`).
- `playbook.create`, `playbook.update`, `playbook.get`, `playbook.list`: new,
  VFS-backed (§6).
- `playbook.validate`: new. Runs the linters (`lintPlaybookIdempotency`,
  `lintTemplateRefs` in `src/config/loader.ts`) without writing anything.
- `inventory.show`, `modules.search`, `docs.search`: already exist in `TOOL_DEFS`.

**Running and debugging:**

- `playbook.run`: exists as a def; re-pointed at real execution (§5).
- `playbook.check`: new name replacing `playbook.diff` (dry-run/diff, `check=true`);
  the old name is dropped, not aliased (breaking changes are expected before 0.1.0).
- `run.status`: already exists in `TOOL_DEFS`.
- `run.trace`: replaces `run.replay` (which today fans out to `GET /runs/:id/trace` and
  `/runs/:id/profile`); replays the run-trace ledger.
- `run.profile`: new named tool for the profile half of the old `run.replay` fan-out.
- `run.resume`, `run.cancel`: new.
- `facts.gather`: exists as a def; re-pointed at the real facts engine (§5).

### 5. Real execution semantics

The run/debug tools MUST invoke the same executor pipeline the CLI uses:
`loadPlaybookFile`/`loadPlaybook` (`src/config/loader.ts`) → `resolveTargets`
(`src/inventory/engine.ts`) → `runPlaybook`/`runTask` (`src/executor/engine.ts`) →
`defaultFactsEngine.gatherFacts` (`src/facts/engine.ts`), with modules registered via
`registerAllModules()` (`src/modules/builtins/index.ts`) plus `scanAndRegister()`
(`src/modules/resolver.ts`). They must NOT use the orchestrator's scaffolded HTTP run
path: `POST /run` in `src/orchestrator/routes.ts` and the `playbook.run` description in
`src/orchestrator/mcp.ts` carry `TODO(ROLECALL-PLACEHOLDER): Wave-0 scaffold` markers
("dispatches into the local run map only, it does not perform real remote state").

In `--serve`/HTTP MCP mode, execution follows ADR 0017's fork-per-run design: fork
`rolecall playbook run … -o json` and parse the ndjson event stream. The stdio server is
also a long-lived process, so it uses the same fork-per-run shape. **A dependency of
this ADR is ADR 0017 landing**: until it does, the run tools are not shipped, rather
than silently riding the scaffold path.

### 6. Authoring tools write through the VFS seam

`playbook.create`/`playbook.update` write through the `ProjectSource` seam
(`src/vfs/project-source.ts`, `FsProjectSource` in `src/vfs/fs-project-source.ts`), not
raw `fs` calls, so they work against disk today and against future git-backed projects
(ADR 0004/0014) without tool changes. Every created or updated playbook is validated
with `PlaybookSchema` and linted with `lintPlaybookIdempotency` + `lintTemplateRefs`
BEFORE it is written; a failing lint is a typed error, never a half-written file.

### 7. Progress and streaming via MCP notifications

Long runs return a stable `runId` immediately; nothing blocks on a single-call run. The
agent polls `run.status`/`run.trace`, and the server emits MCP progress/logging
notifications fed by the run-trace ledger, so an interactive harness sees task-level
progress without holding the RPC open; the fork child's ndjson events (ADR 0017) land
in that ledger.

### 8. Protocol layer: the official SDK, not hand-rolled JSON-RPC

Use `@modelcontextprotocol/sdk` (TypeScript) rather than hand-rolling the protocol: the
initialize/capabilities handshake, transport framing, and spec evolution are exactly what
should not be hand-rolled. The cost is a new runtime dependency, in contrast with ADR
0019 which just removed one (drizzle-orm); the difference is that the SDK implements an
external protocol we would otherwise chase by hand. Dual-runtime obligations apply per
ADR 0018: it must work on Node and Bun, be embedded by the `bun run build:js` bundle
(`--packages=external` keeps it a real runtime import), and respect the
createRequire-only laziness rule if any runtime-specific import is ever needed.
Considered and rejected: a zero-dependency hand-rolled stdio JSON-RPC loop; protocol
correctness and transport churn outweigh saving one small dependency.

### 9. Security and guardrails

MCP clients get powerful write+run tools, so: exposing the server is explicit opt-in
(`rolecall mcp` must be started by the user; the HTTP transport mounts only under
`--serve`); the HTTP transport honors the existing orchestrator auth token; and the tools
inherit RoleCall's existing guarantees: schema-validated fail-closed input
(`validateToolInput`), typed errors, and `playbook.check` dry-run/diff before apply.
Harness builders get documented blast-radius guidance, as in comparison §10.
Reaffirmed: no LLM provider or agent loop is embedded in RoleCall; the harness stays
external. MCP changes the transport, not that boundary.

## Consequences

**Positive**
- Native integration with MCP-speaking agent harnesses, with no bespoke glue, skill-file
  indirection, or manifest polling.
- Full reuse of the schema/registry/validator stack (`TOOL_DEFS`, `buildManifest()`,
  `validateToolInput()`, `PlaybookSchema`/`InventorySchema`): one catalog, three adapters.
- The clientless REST surface is preserved unchanged; existing integrations keep working.
- Authoring tools close the biggest agent-workflow gap: an agent can create, validate,
  run, and debug a playbook without leaving the protocol.
- Real execution via the CLI/executor pipeline (and ADR 0017's fork in serve mode) gives
  MCP runs the same semantics and observability as CLI runs.

**Negative / risk**
- A new runtime dependency (`@modelcontextprotocol/sdk`) immediately after ADR 0019
  removed one; supply-chain and bundle-size cost on every channel.
- A new protocol surface to maintain and version alongside REST and the CLI; three
  adapters must stay in lockstep (§2's registry mitigates, but lockstep is an obligation).
- MCP spec churn: the protocol is evolving and streamable-HTTP transport semantics may
  change; SDK upgrades will be recurring.
- Serve-mode run/debug tools depend on ADR 0017 landing; until then they cannot be honest
  about execution.
- The `/mcp` path collision (`GET /mcp` manifest vs MCP JSON-RPC) is a permanent footgun
  for docs and tooling; the `/mcp/v1` scheme mitigates but does not remove it.
- Security blast radius: agent-driven write+run tools over a protocol designed for
  autonomous clients; opt-in, the auth token, and dry-run guidance are mitigations, not
  guarantees.
- Dual-runtime verification burden: every MCP surface must be tested under both
  `ROLECALL_RUNTIME` branches and survive the Node bundle guard.

## Work items
- [ ] Extend `TOOL_DEFS` in `src/orchestrator/mcp.ts` with the authoring and run/debug tools (§4), including the `playbook.diff` → `playbook.check` and `run.replay` → `run.trace`/`run.profile` renames
- [ ] Implement `src/mcp/`: server core over `@modelcontextprotocol/sdk`, stdio transport, and the streamable-HTTP transport mounted in `src/orchestrator/serve.ts` at `/mcp/v1`
- [ ] Add the `rolecall mcp` subcommand to `src/cli/index.ts` (`GLOBAL_OPTS`/HELP)
- [ ] Wire run/debug tools to the executor pipeline (`loadPlaybookFile` → `resolveTargets` → `runPlaybook`, `defaultFactsEngine.gatherFacts`) and, in serve mode, to ADR 0017's fork-per-run ndjson stream
- [ ] Implement `runId` + progress/logging notifications fed by the run-trace ledger
- [ ] Wire authoring tools through `ProjectSource`/`FsProjectSource` with validate-before-write (`PlaybookSchema` + both linters)
- [ ] Dual-runtime tests (`ROLECALL_RUNTIME=bun` and `ROLECALL_RUNTIME=node`) covering both transports, plus Node-bundle verification
- [ ] Four-surface doc sync per AGENTS.md (AGENTS.md, README.md, design/ including the `design/README.md` map row, docs/) and a comparison §10 status note

## References
- `src/orchestrator/mcp.ts` (`TOOL_DEFS`, `buildManifest()`, `validateToolInput()`: the registry this ADR extends)
- `src/orchestrator/routes.ts` (`ROUTE_DEFINITIONS`, `GET /mcp`, scaffolded `POST /run`), `src/orchestrator/serve.ts`, `src/orchestrator/engine.ts` (scaffolded run map)
- `src/executor/engine.ts`, `src/executor/module.ts`, `src/modules/builtins/index.ts`, `src/modules/resolver.ts` (the real execution pipeline)
- `src/config/loader.ts`, `src/config/schema.ts` (loaders, linters, canonical schemas), `src/inventory/engine.ts`, `src/facts/engine.ts`
- `src/vfs/project-source.ts`, `src/vfs/fs-project-source.ts` (the authoring write seam)
- `design/ansible-comparison.md` §10 (the clientless stance this ADR revises)
- ADR 0003 (Zod-driven agent surface), ADR 0014 (project architecture), ADR 0017 (fork-per-run), ADR 0018 (dual runtime), ADR 0019 (dependency-removal precedent)
