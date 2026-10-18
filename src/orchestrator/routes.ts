// HTTP route handlers for the RoleCall orchestrator server (Task 18).
//
// All bodies return JSON. Unknown PATH -> 404 JSON; KNOWN PATH + disallowed METHOD
// -> 405 JSON. Uncaught exceptions funnel to a final error handler that returns a
// clean message WITHOUT leaking stack traces or secrets. Validation errors are 4xx.
//
// The single source of truth for WHAT is served is ROUTE_DEFINITIONS below. Both
// mountRoutes() (HTTP mount) and src/orchestrator/openapi.ts::buildOpenApi() iterate
// THAT array, so the mounted endpoints and the generated OpenAPI spec can never drift.

// Local request/response/next shapes mirroring src/orchestrator/express.d.ts.
// Defined inline rather than imported from the ambient express shim so these
// names always resolve WITHOUT requiring @types/express or altering serve.ts usage.
type Request = { method: string; url: string; params: Record<string, string>; query: unknown; headers: Record<string, string | string[] | undefined>; body: unknown };
type Response = { headersSent?: boolean; status(code: number): Response; json(body?: unknown): void; send(body?: unknown): void; set(field: string, value: string): Response };
import { isValid } from "./cron";
import { mountDocs } from "./docs";
import { makeNotFoundHandler, makeErrorHandler } from "./route-tail";
import { buildManifest, validateToolInput } from "./mcp";
import { resolveTargets } from "../inventory/engine";
import { loadInventoryFile, resolveDirectoryVars, type DirectoryVars } from "../config/loader";
import { searchModules } from "../modules/search";
import { searchDocs, type DocHit } from "../docs/search";
import { normalizeInventory, InventorySchema, type NormalizedInventory, type RawInventory } from "../config/schema";
import { FsProjectSource } from "../vfs/fs-project-source";
import { dirname } from "node:path";
import type { Store } from "../store";
import type { CreateProjectInput, CreateScheduleInput } from "../store/types";
import type { Engine } from "./engine";
import type { SchedulerApi } from "./types";
import { handleTrigger } from "./webhooks";
import { validateRunJob } from "./job-validation";

/** Context injected into every route handler: engine plus optional store, scheduler, auth token. */
export interface RouteContext {
  engine: Engine;
  store?: Store;
  scheduler?: SchedulerApi;
  /** Optional single-token Bearer guard for webhook/REST triggers (Todo 21). */
  authToken?: string;
}

/** Minimal Express-app surface used by mountRoutes(). Loose on purpose — see express.d.ts. */
interface App {
  get(path: string, handler: (req: Request, res: Response) => unknown): this;
  post(path: string, handler: (req: Request, res: Response) => unknown): this;
  put(path: string, handler: (req: Request, res: Response) => unknown): this;
  delete(path: string, handler: (req: Request, res: Response) => unknown): this;
  // Middleware tail accepts any arity incl. the 4-arg error handler.
  use(...handlers: unknown[]): this;
}

/** HTTP verb handled by a route definition. */
type HttpMethod = "get" | "post" | "put" | "delete";

/**
 * Loose OpenAPI-shaped metadata attached to each route. Kept structural (no openapi
 * typings dependency) so this module stays dependency-free while still feeding the
 * spec builder rich summaries / parameters / request-body examples / responses.
 */
interface RouteOperationDoc {
  /** One-line summary shown as the operation summary in the generated spec. */
  summary: string;
  /** Longer description; honest Wave-0 scaffold caveats belong here. */
  description?: string;
  /** Logical grouping reused for tags / summaries. */
  group?: string;
  /** Present when the endpoint carries an optional single-token Bearer guard (Todo 21); documented honestly as present-but-limited RBAC. */
  security?: Array<Record<string, readonly []>>;
  /** Path/query/header params. Express-style ":x" names are preserved verbatim so spec path keys match mounted paths exactly. */
  parameters?: ReadonlyArray<{ name: string; in: string; required?: boolean; description?: string; schema?: Record<string, unknown> }>;
  /** Request-body example(s), keyed by media type. */
  requestBody?: { content: Record<string, { schema?: Record<string, unknown>; example?: unknown }> };
  /** Response envelope keyed by status-code string. */
  responses?: Record<string, { description: string; content?: Record<string, { schema?: Record<string, unknown>; example?: unknown }> }>;
}

/** A single registered server-mode endpoint: static doc metadata PLUS the closure that mounts its handler onto the app surface. This array is THE single source of truth consumed by BOTH mountRoutes() and buildOpenApi(). */
export interface RouteDefinition extends RouteOperationDoc {
  method: HttpMethod;
  path: string;
  /** Attaches this route's concrete handler to the mounted app using ctx. Handler BODIES live inside here unchanged. */
  apply(api: App, ctx: RouteContext): void;
}

/** Shared liveness body reused across GET /,/health,/ping — returns service ok JSON. */
const ok = (_req: Request, res: Response): void => res.status(200).json({ service: "rolecall", status: "ok" });

/**
 * Canonical list of every server-mode endpoint. Mounting (mountRoutes) and spec
 * generation (buildOpenApi) iterate THIS array, so they cannot drift. Each entry's
 * `apply` contains the exact original handler logic (bodies untouched) wrapped in an
 * api.<method>(path, <handler>) call.
 */
export const ROUTE_DEFINITIONS: RouteDefinition[] = [
  // --- liveness -------------------------------------------------------------
  {
    method: "get",
    path: "/",
    summary: "Service root + health probe",
    group: "liveness",
    description: "Root probe returning service reachability JSON.",
    responses: { "200": { description: "Service reachable." } },
    apply: (api) => { api.get("/", ok); },
  },
  {
    method: "get",
    path: "/health",
    summary: "Health check",
    group: "liveness",
    description: "Liveness probe returning service ok JSON.",
    responses: { "200": { description: "Service healthy." } },
    apply: (api) => { api.get("/health", ok); },
  },
  {
    method: "get",
    path: "/ping",
    summary: "Ping",
    group: "liveness",
    description: "Simple connectivity ping endpoint.",
    responses: { "200": { description: "Reachable." } },
    apply: (api) => { api.get("/ping", ok); },
  },
  {
    method: "get",
    path: "/status",
    summary: "Orchestrator status",
    group: "liveness",
    // TODO(ROLECALL-PLACEHOLDER): Wave-0 scaffold executor — no real remote state (status counts are local only)
    description: "Aggregated status: engine run counts plus best-effort project count. The executor is Wave-0 scaffold, so counts reflect the local run map only.",
    responses: { "200": { description: "Aggregate status object." } },
    apply: (api, ctx) => {
      api.get("/status", async (_req, res): Promise<void> => {
        const runs = ctx.engine.list();
        const active = ctx.engine.active();
        let projectCount = 0;
        try { projectCount = ctx.store ? (await ctx.store.projects.list()).length : 0; } catch { /* best-effort */ }
        res.status(200).json({
          service: "rolecall",
          status: "ok",
          mode: "serve",
          runsTotal: runs.length,
          runsActive: active,
          projects: projectCount,
        });
      });
    },
  },

  // --- run dispatch ---------------------------------------------------------
  {
    method: "post",
    path: "/run",
    summary: "Dispatch a run",
    group: "run dispatch",
    // TODO(ROLECALL-PLACEHOLDER): Wave-0 scaffold executor — no real remote state (dispatches to local run map only)
    description: "Enqueues playbook|adhoc|nonIdempotent work via the engine. Wave-0 scaffold: plans/dispatches into the local run map only, it does not perform real remote state.",
    requestBody: { content: { "application/json": { schema: { type: "object", properties: { type: { type: "string", enum: ["playbook", "adhoc", "nonIdempotent"] } }, required: ["type"] }, example: { type: "playbook", playbookRef: "site.yaml", hosts: ["web1.example.com"] } } } },
    responses: { "202": { description: "Run queued." }, "400": { description: "Body missing or invalid 'type'." } },
    apply: (api, ctx) => {
      api.post("/run", (req, res): void => {
        const result = validateRunJob(req.body);
        if (!result.ok) {
          res.status(400).json({ error: "invalid run job", fieldErrors: result.fieldErrors });
          return;
        }
        try {
          const id = ctx.engine.enqueue(result.value);
          res.status(202).json({ runId: id, status: "queued", type: result.value.type, self: `/runs/${id}/status` });
        } catch (err) {
          res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
        }
      });
    },
  },

  {
    method: "get",
    path: "/runs/:id/status",
    summary: "Run status",
    group: "run dispatch",
    description: "Returns the live record of a dispatched run by id.",
    parameters: [{ name: "id", in: "path", required: true, description: "Run identifier.", schema: { type: "string" } }],
    responses: { "200": { description: "Run record." }, "404": { description: "Unknown run." } },
    apply: (api, ctx) => {
      api.get("/runs/:id/status", (req, res): void => {
        const rec = ctx.engine.get(req.params.id ?? "");
        if (!rec) { res.status(404).json({ error: "unknown run" }); return; }
        res.status(200).json({
          runId: rec.id,
          type: rec.jobType,
          status: rec.status,
          startedAt: rec.startedAt,
          finishedAt: rec.finishedAt ?? null,
          dispatchCount: rec.dispatchCount,
          outcomes: rec.outcomes,
          result: rec.status === "success" ? rec.outcomes : null,
          error: rec.error ?? null,
        });
      });
    },
  },

  // --- run trace + profile (Todo 25) ---------------------------------------
  {
    method: "get",
    path: "/runs/:id/trace",
    summary: "Run execution trace",
    group: "run dispatch",
    description: "Returns the persisted execution-trace ledger for a run: per-task/per-iteration events with timing + outcome. Enables replay + failure-locality inspection. The ledger is populated when a run is executed with tracing enabled (Todo 25).",
    parameters: [{ name: "id", in: "path", required: true, description: "Run identifier.", schema: { type: "string" } }],
    responses: {
      "200": { description: "Trace ledger for the run." },
      "404": { description: "Unknown run and no trace events." },
    },
    apply: (api, ctx) => {
      api.get("/runs/:id/trace", async (req, res): Promise<void> => {
        const id = req.params.id ?? "";
        const traces = await ctx.store!.traces.listByRun(id);
        const run = await ctx.store!.runs.get(id);
        if (!run && traces.length === 0) { res.status(404).json({ error: "unknown run" }); return; }
        res.status(200).json({ runId: id, found: run !== null, traces });
      });
    },
  },
  {
    method: "get",
    path: "/runs/:id/profile",
    summary: "Run performance profile",
    group: "run dispatch",
    description: "Aggregates the run's trace ledger into per-host wall-clock timing + failure counts (Todo 25). Lightweight performance profiling: sum of end-phase duration_ms per host.",
    parameters: [{ name: "id", in: "path", required: true, description: "Run identifier.", schema: { type: "string" } }],
    responses: {
      "200": { description: "Per-host performance profile." },
      "404": { description: "Unknown run and no trace events." },
    },
    apply: (api, ctx) => {
      api.get("/runs/:id/profile", async (req, res): Promise<void> => {
        const id = req.params.id ?? "";
        const traces = await ctx.store!.traces.listByRun(id);
        const run = await ctx.store!.runs.get(id);
        if (!run && traces.length === 0) { res.status(404).json({ error: "unknown run" }); return; }
        const profile: Record<string, { tasks: number; totalMs: number; failed: number }> = {};
        for (const t of traces) {
          if (t.phase !== "end") continue;
          const e = (profile[t.host] ??= { tasks: 0, totalMs: 0, failed: 0 });
          e.tasks += 1;
          e.totalMs += t.durationMs ?? 0;
          if (t.status === "failed") e.failed += 1;
        }
        res.status(200).json({ runId: id, found: run !== null, profile });
      });
    },
  },

  // --- projects CRUD (persisted via Task-19 store) --------------------------
  {
    method: "post",
    path: "/projects",
    summary: "Create project",
    group: "projects",
    description: "Creates a persisted Project row. Only `path` is required.",
    requestBody: { content: { "application/json": { schema: { type: "object", properties: { path: { type: "string" }, inventoryRef: { type: "string" }, playbookRef: { type: "string" }, vars: { type: "object" } }, required: ["path"] }, example: { path: "/srv/site", inventoryRef: "inv.yaml", playbookRef: "site.yaml" } } } },
    responses: { "201": { description: "Created project." }, "400": { description: "Missing non-empty 'path'." }, "500": { description: "Persistence failure." } },
    apply: (api, ctx) => {
      api.post("/projects", async (req, res): Promise<void> => {
        const p = req.body as Partial<{ path: string; inventoryRef?: string; playbookRef?: string; vars?: Record<string, unknown> }> | undefined;
        if (!p || typeof p.path !== "string" || p.path.length === 0) { res.status(400).json({ error: "project requires a non-empty 'path'" }); return; }
        try {
          const input: CreateProjectInput = { path: p.path, inventoryRef: p.inventoryRef, playbookRef: p.playbookRef, vars: p.vars };
          const created = await ctx.store!.projects.create(input);
          res.status(201).json(created);
        } catch { res.status(500).json({ error: "failed to create project" }); }
      });
    },
  },

  {
    method: "get",
    path: "/projects",
    summary: "List projects",
    group: "projects",
    description: "Lists all persisted Projects.",
    responses: { "200": { description: "Array of projects." }, "500": { description: "Persistence failure." } },
    apply: (api, ctx) => {
      api.get("/projects", async (_req, res): Promise<void> => {
        try { res.status(200).json(await ctx.store!.projects.list()); }
        catch { res.status(500).json({ error: "failed to list projects" }); }
      });
    },
  },

  {
    method: "put",
    path: "/projects/:id",
    summary: "Update project",
    group: "projects",
    description: "Patches an existing Project. Provided fields replace/merge.",
    parameters: [{ name: "id", in: "path", required: true, description: "Project identifier.", schema: { type: "string" } }],
    requestBody: { content: { "application/json": { schema: { type: "object", additionalProperties: true }, example: { inventoryRef: "inv-v2.yaml" } } } },
    responses: { "200": { description: "Updated project." }, "400": { description: "Empty update body." }, "404": { description: "Unknown project." }, "500": { description: "Persistence failure." } },
    apply: (api, ctx) => {
      api.put("/projects/:id", async (req, res): Promise<void> => {
        try {
          const patch = req.body as Record<string, unknown>;
          if (!patch || Object.keys(patch).length === 0) { res.status(400).json({ error: "empty update body" }); return; }
          const updated = await ctx.store!.projects.update(req.params.id ?? "", patch);
          if (!updated) { res.status(404).json({ error: "unknown project" }); return; }
          res.status(200).json(updated);
        } catch { res.status(500).json({ error: "failed to update project" }); }
      });
    },
  },

  {
    method: "delete",
    path: "/projects/:id",
    summary: "Delete project",
    group: "projects",
    description: "Deletes a persisted Project by id.",
    parameters: [{ name: "id", in: "path", required: true, description: "Project identifier.", schema: { type: "string" } }],
    responses: { "200": { description: "Deleted." }, "404": { description: "Unknown project." }, "500": { description: "Persistence failure." } },
    apply: (api, ctx) => {
      api.delete("/projects/:id", async (req, res): Promise<void> => {
        try {
          const deleted = await ctx.store!.projects.delete(req.params.id ?? "");
          if (!deleted) { res.status(404).json({ error: "unknown project" }); return; }
          res.status(200).json({ deleted: true });
        } catch { res.status(500).json({ error: "failed to delete project" }); }
      });
    },
  },

  // --- schedule management (minimal create / list / cancel) -----------------
  {
    method: "post",
    path: "/schedules",
    summary: "Create schedule",
    group: "schedules",
    description: "Creates a cron-driven Schedule. Requires name + cronSpec (valid) + actionType.",
    requestBody: { content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" }, cronSpec: { type: "string" }, actionType: { type: "string" }, params: { type: "object" }, enabled: { type: "boolean" } }, required: ["name", "cronSpec", "actionType"] }, example: { name: "nightly", cronSpec: "0 2 * * *", actionType: "playbook", params: { playbookRef: "site.yaml" }, enabled: true } } } },
    responses: { "201": { description: "Created schedule." }, "400": { description: "Missing fields or invalid cron spec." }, "500": { description: "Persistence failure." } },
    apply: (api, ctx) => {
      api.post("/schedules", async (req, res): Promise<void> => {
        const s = req.body as Partial<{ name: string; cronSpec: string; actionType: string; params?: Record<string, unknown>; enabled?: boolean }>;
        if (!s || typeof s.name !== "string" || !s.cronSpec || !s.actionType) {
          res.status(400).json({ error: "schedule requires name + cronSpec + actionType" });
          return;
        }
        if (!isValid(s.cronSpec)) {
          res.status(400).json({ error: `invalid cron spec '${String(s.cronSpec)}'` });
          return;
        }
        try {
          const input: CreateScheduleInput = { name: s.name, cronSpec: s.cronSpec, actionType: s.actionType, params: s.params, enabled: s.enabled };
          const created = await ctx.store!.schedules.create(input);
          res.status(201).json(created);
        } catch { res.status(500).json({ error: "failed to create schedule" }); }
      });
    },
  },

  {
    method: "get",
    path: "/schedules",
    summary: "List schedules",
    group: "schedules",
    description: "Lists all persisted Schedules.",
    responses: { "200": { description: "Array of schedules." }, "500": { description: "Persistence failure." } },
    apply: (api, ctx) => {
      api.get("/schedules", async (_req, res): Promise<void> => {
        try { res.status(200).json(await ctx.store!.schedules.list()); }
        catch { res.status(500).json({ error: "failed to list schedules" }); }
      });
    },
  },

  {
    method: "delete",
    path: "/schedules/:id",
    summary: "Cancel schedule",
    group: "schedules",
    description: "Cancels (deletes) a Schedule by id.",
    parameters: [{ name: "id", in: "path", required: true, description: "Schedule identifier.", schema: { type: "string" } }],
    responses: { "200": { description: "Cancelled." }, "404": { description: "Unknown schedule." }, "500": { description: "Persistence failure." } },
    apply: (api, ctx) => {
      api.delete("/schedules/:id", async (req, res): Promise<void> => {
        try {
          const cancelled = await ctx.store!.schedules.delete(req.params.id ?? "");
          if (!cancelled) { res.status(404).json({ error: "unknown schedule" }); return; }
          res.status(200).json({ cancelled: true });
        } catch { res.status(500).json({ error: "failed to cancel schedule" }); }
      });
    },
  },

  // --- webhook & REST run triggers (Todo 21) --------------------------------
  // AuthToken gates both endpoints via the shared trigger handler. Documented with
  // security + 401 and honestly marked present-but-limited RBAC.
  {
    method: "post",
    path: "/webhook",
    summary: "Webhook run trigger",
    group: "triggers",
    description: "Starts an orchestrator run from an external payload ({ type, ...jobFields }). Payload is validated strictly BEFORE dispatch. Optional single-token Bearer guard rejects unauthenticated requests when set; RBAC remains deferred.",
    security: [{ bearerAuth: [] }],
    requestBody: { content: { "application/json": { schema: { type: "object", properties: { type: { type: "string", enum: ["playbook", "adhoc", "nonIdempotent"] }, actionType: { type: "string" }, targetIds: { type: "array", items: { type: "string" } } }, required: ["type"] }, example: { type: "adhoc", actionType: "ping", targetIds: ["web1.example.com"] } } } },
    responses: { "202": { description: "Run queued." }, "400": { description: "Invalid job body." }, "401": { description: "Missing/incorrect Bearer token." } },
    apply: (api, ctx) => { api.post("/webhook", handleTrigger({ engine: ctx.engine, authToken: ctx.authToken })); },
  },

  {
    method: "post",
    path: "/api/run",
    summary: "REST run trigger",
    group: "triggers",
    description: "Identical trigger surface to POST /webhook but exposed as a plain REST endpoint. Same strict validation + optional Bearer guard; RBAC deferred.",
    security: [{ bearerAuth: [] }],
    requestBody: { content: { "application/json": { schema: { type: "object", properties: { type: { type: "string", enum: ["playbook", "adhoc", "nonIdempotent"] }, actionType: { type: "string" }, targetIds: { type: "array", items: { type: "string" } } }, required: ["type"] }, example: { type: "playbook", playbookRef: "site.yaml" } } } },
    responses: { "202": { description: "Run queued." }, "400": { description: "Invalid job body." }, "401": { description: "Missing/incorrect Bearer token." } },
    apply: (api, ctx) => { api.post("/api/run", handleTrigger({ engine: ctx.engine, authToken: ctx.authToken })); },
  },

  {
    method: "get",
    path: "/mcp",
    summary: "Agent tool manifest (clientless MCP surface)",
    group: "agent",
    description: "Discoverable agent tool catalog. Returns JSON-schema tool specs (generated from the Zod schemas in src/config/schema.ts) each naming its REST method + path + params. This IS the integration surface — any LLM runtime drives the named endpoints with stock HTTP, no MCP SDK required.",
    responses: { "200": { description: "Agent tool manifest." } },
    apply: (api) => {
      api.get("/mcp", (_req, res): void => {
        res.status(200).json(buildManifest());
      });
    },
  },
  {
    method: "post",
    path: "/facts",
    summary: "Agent tool: facts.gather",
    group: "agent",
    description: "facts.gather — resolve the target hosts an inventory WOULD gather facts from. Body is an inline inventory (validated by InventorySchema) plus an optional limit. Returns resolvedHosts + per-host vars (typed JSON).",
    requestBody: { content: { "application/json": { schema: { type: "object", properties: { inventory: { type: "object" }, limit: { type: "string" } }, required: ["inventory"] }, example: { inventory: { groups: { all: { hosts: ["web1.example.com"] } } } } } } },
    responses: { "200": { description: "Resolved hosts." }, "400": { description: "Schema-invalid body; named field path." } },
    apply: (api) => {
      api.post("/facts", async (req, res): Promise<void> => {
        const v = validateToolInput("facts.gather", req.body);
        if (!v.ok) { res.status(400).json({ error: "invalid facts.gather input", fieldErrors: v.errors }); return; }
        const data = v.data as { inventory: RawInventory; limit?: string };
        try {
          const normalized: NormalizedInventory = normalizeInventory(data.inventory);
          const targets = data.limit ? [data.limit] : ["all"];
          const resolved = await resolveTargets(normalized, targets);
          res.status(200).json({ command: "facts.gather", resolvedHosts: resolved.matchedHosts, hosts: resolved.hosts });
        } catch (err) {
          res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
        }
      });
    },
  },
  {
    method: "get",
    path: "/modules",
    summary: "Agent tool: modules.search",
    group: "agent",
    description: "modules.search — search registered RoleCall modules by name/description substring (case-insensitive). Returns typed module summaries including idempotency metadata.",
    parameters: [{ name: "q", in: "query", required: true, description: "Search term substring.", schema: { type: "string" } }],
    responses: { "200": { description: "Module summaries." }, "400": { description: "Missing/invalid 'q'." } },
    apply: (api) => {
      api.get("/modules", (req, res): void => {
        const rawQ = (req.query as Record<string, unknown> | undefined)?.q;
        if (rawQ === undefined) {
          res.status(400).json({ error: "missing query parameter 'q'", fieldErrors: [{ path: "q", message: "required string query parameter" }] });
          return;
        }
        const q = typeof rawQ === "string" ? rawQ : String(rawQ);
        const v = validateToolInput("modules.search", { q });
        if (!v.ok) { res.status(400).json({ error: "invalid modules.search input", fieldErrors: v.errors }); return; }
        res.status(200).json({ command: "modules.search", query: q, modules: searchModules(q) });
      });
    },
  },
  {
    method: "get",
    path: "/mcp/docs",
    summary: "Agent tool: docs.search",
    group: "agent",
    description: "docs.search — case-insensitive substring search over RoleCall prose markdown docs under docs/content/**/*.md. Returns matched sections with nearest heading, source line, and trimmed snippet. Mounted at /mcp/docs (NOT /docs, which is Swagger UI via mountDocs).",
    parameters: [{ name: "q", in: "query", required: true, description: "Documentation search term.", schema: { type: "string" } }],
    responses: { "200": { description: "Doc hits grouped by section." }, "400": { description: "Missing/invalid 'q'." } },
    apply: (api) => {
      api.get("/mcp/docs", async (req, res): Promise<void> => {
        const rawQ = (req.query as Record<string, unknown> | undefined)?.q;
        if (rawQ === undefined) {
          res.status(400).json({ error: "missing query parameter 'q'", fieldErrors: [{ path: "q", message: "required string query parameter" }] });
          return;
        }
        const q = typeof rawQ === "string" ? rawQ : String(rawQ);
        const v = validateToolInput("docs.search", { q });
        if (!v.ok) { res.status(400).json({ error: "invalid docs.search input", fieldErrors: v.errors }); return; }
        let hits: DocHit[] = [];
        try {
          hits = (await searchDocs(q)).hits;
        } catch (err) {
          res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
          return;
        }
        res.status(200).json({ command: "docs.search", query: q, count: hits.length, hits });
      });
    },
  },
  {
    method: "get",
    path: "/inventory",
    summary: "Agent tool: inventory.show",
    group: "agent",
    description: "inventory.show — resolve an inventory into matched hosts + per-host vars (typed JSON). Supply a YAML file path via ?path= or an inline JSON inventory via ?data=.",
    parameters: [
      { name: "path", in: "query", required: false, description: "Inventory YAML file path.", schema: { type: "string" } },
      { name: "data", in: "query", required: false, description: "Inline JSON inventory (URL-encoded string).", schema: { type: "string" } },
    ],
    responses: { "200": { description: "Resolved hosts + vars." }, "400": { description: "Missing source or invalid inline inventory; named field path." } },
    apply: (api) => {
      api.get("/inventory", async (req, res): Promise<void> => {
        const query = (req.query as Record<string, unknown> | undefined) ?? {};
        const path = typeof query.path === "string" ? query.path : undefined;
        const data = typeof query.data === "string" ? query.data : undefined;
        if (!path && !data) {
          res.status(400).json({ error: "missing 'path' or 'data'", fieldErrors: [{ path: "path", message: "one of 'path' (inventory file) or 'data' (inline JSON inventory) is required" }] });
          return;
        }
        try {
          let normalized: NormalizedInventory;
          let dirVars: DirectoryVars = { groupVarsByGroup: {}, hostVarsByHost: {} };
          if (path) {
            const source = new FsProjectSource(dirname(path));
            normalized = await loadInventoryFile(path, source);
            dirVars = await resolveDirectoryVars(path, source);
          } else {
            let parsed: unknown;
            try { parsed = JSON.parse(data as string); } catch {
              res.status(400).json({ error: "invalid JSON in 'data'", fieldErrors: [{ path: "data", message: "must be valid JSON" }] });
              return;
            }
            const inv = InventorySchema.safeParse(parsed);
            if (!inv.success) {
              res.status(400).json({ error: "invalid inline inventory", fieldErrors: inv.error.issues.map((i) => ({ path: `data.${i.path.join(".")}` || "data", message: i.message })) });
              return;
            }
            normalized = normalizeInventory(inv.data as RawInventory);
          }
          const resolved = await resolveTargets(normalized, ["all"], {
            groupVars: dirVars.groupVarsByGroup,
            hostVars: dirVars.hostVarsByHost,
          });
          res.status(200).json({ command: "inventory.show", matchedHosts: resolved.matchedHosts, hosts: resolved.hosts });
        } catch (err) {
          res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
        }
      });
    },
  },
];

/**
 * Register every resource route from ROUTE_DEFINITIONS plus the terminal 404/405/error
 * middlewares. Each def's methods are recorded into the known-path registry consumed by
 * makeNotFoundHandler() so unknown/disallowed requests still resolve correctly.
 */
export function mountRoutes(app: object, ctx: RouteContext): void {
  // Express v5 app typing is loose via the ambient shim; cast once here so the
  // concrete get/post/put/delete/use calls below stay fully typed.
  const api = app as unknown as App;
  // Registry of known path patterns -> allowed methods, used by the 404/405 tail.
  // Mirrors exactly what buildOpenApi() enumerates (same source array).
  const ROUTES = new Map<string, Set<string>>();
  const record = (path: string, method: string): void => {
    const s = ROUTES.get(path) ?? new Set<string>();
    s.add(method);
    ROUTES.set(path, s);
  };
  // Liveness endpoints first (/,/health,/ping,/status). Mounting these up front keeps their
  // original handler logic byte-for-byte unchanged while giving the docs/spec routes below a
  // stable slot right after them and ahead of the terminal tail.
  for (const def of ROUTE_DEFINITIONS) {
    if (def.group !== "liveness") continue;
    record(def.path, def.method);
    def.apply(api, ctx);
  }

  // C10 (additive): raw OpenAPI spec at GET /docs.json and Swagger UI at GET /docs. These sit
  // AFTER liveness but BEFORE the 404/405/error middlewares so they never fall through to the
  // tail. No handler body or return shape under src/orchestrator changes.
  for (const reg of mountDocs(api)) {
    record(reg.path, reg.method);
  }

  // Remaining resource routes (run dispatch, projects, schedules, triggers).
  for (const def of ROUTE_DEFINITIONS) {
    if (def.group === "liveness") continue;
    record(def.path, def.method);
    def.apply(api, ctx);
  }

  api.use(makeNotFoundHandler(ROUTES));
  api.use(makeErrorHandler());
}
