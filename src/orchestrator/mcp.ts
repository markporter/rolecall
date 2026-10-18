// Clientless REST agent surface for RoleCall (Todo 28).
//
// This module is the SINGLE SOURCE OF TRUTH for the agent tool catalog. Both
// `GET /mcp` (src/orchestrator/routes.ts) and `rolecall agent manifest`
// (src/cli/commands/agent.ts) call buildManifest() here, so the served spec and
// the offline CLI artifact can never drift.
//
// CRITICAL: every tool's inputSchema is produced by zod's toJSONSchema() over a
// real Zod schema, and where a tool carries config data (inventory / playbook)
// it REUSES the canonical schemas from src/config/schema.ts. The manifest is
// therefore generated FROM the schema, not hand-written JSON — it cannot drift.
//
// "Clientless" design: there is NO separate MCP server binary and NO LLM vendor /
// agent loop inside RoleCall. The manifest is plain HTTP-discoverable JSON; any LLM
// runtime drives the named REST endpoints with stock HTTP. A minimal LLM "skill"
// file (host + GET /mcp) is the entire integration.

import { z, toJSONSchema } from "zod";
import {
  InventorySchema,
  PlaybookSchema,
  normalizeInventory,
  type NormalizedInventory,
  type RawInventory,
} from "../config/schema";

// ---------------------------------------------------------------------------
// Tool input schemas — GENERATED from Zod; reuse schema.ts so they never drift.
// ---------------------------------------------------------------------------

/** facts.gather (POST /facts): an inline inventory + optional host limit. */
export const FactsGatherInputSchema = z.object({
  inventory: InventorySchema,
  limit: z.string().optional(),
});

/** playbook.run / playbook.diff (POST /run): job body reusing the config schemas. */
export const PlaybookRunInputSchema = z.object({
  type: z.enum(["playbook", "adhoc", "nonIdempotent"]),
  playbook: PlaybookSchema.optional(),
  inventory: InventorySchema.optional(),
  targets: z.array(z.string()).optional(),
  limit: z.string().optional(),
  check: z.boolean().optional(),
  diff: z.boolean().optional(),
  force: z.boolean().optional(),
});

/** run.replay / run.status (path-param id). */
export const RunIdInputSchema = z.object({
  id: z.string().min(1),
});

/** modules.search (GET /modules?q=). */
export const ModulesSearchInputSchema = z.object({
  q: z.string(),
});

/** docs.search (GET /mcp/docs?q=): a prose-doc substring term (`q`) plus an optional hit cap. Field is `q` to match the REST query param and the modules.search convention. */
export const DocsSearchInputSchema = z.object({
  q: z.string().min(1),
  limit: z.number().int().positive().max(100).optional(),
});

/** inventory.show (GET /inventory): either a file path or inline JSON inventory. */
export const InventoryShowInputSchema = z.object({
  path: z.string().optional(),
  data: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Manifest types
// ---------------------------------------------------------------------------

/** A single named REST parameter in a tool spec. */
export interface McpToolParam {
  /** Parameter name (path/query token or body field). */
  name: string;
  /** Where the parameter lives in the REST call. */
  in: "path" | "query" | "body";
  /** Whether the parameter is required. */
  required?: boolean;
  /** Human-readable description. */
  description?: string;
}

/** REST routing metadata attached to each tool spec. */
export interface McpToolRest {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  params: McpToolParam[];
  /** Additional endpoints the tool fans out to (e.g. replay's profile endpoint). */
  related?: ReadonlyArray<{ method: "GET" | "POST" | "PUT" | "DELETE"; path: string }>;
}

/** One tool in the agent catalog. */
export interface McpToolSpec {
  name: string;
  description: string;
  /** JSON-schema (draft-07-ish) produced by zod's toJSONSchema(). */
  inputSchema: Record<string, unknown>;
  rest: McpToolRest;
}

/** The full discoverable agent manifest returned by GET /mcp. */
export interface McpManifest {
  name: string;
  description: string;
  transport: "http";
  version: string;
  endpoints: { manifest: { method: "GET"; path: "/mcp" } };
  tools: McpToolSpec[];
}

/** A single named-field validation failure (fail-closed contract). */
export interface FieldError {
  path: string;
  message: string;
}

/** Result of validating an agent tool call's input. */
export type ToolValidation =
  | { ok: true; data: unknown }
  | { ok: false; errors: FieldError[] };

// ---------------------------------------------------------------------------
// Tool registry — the canonical list mapping tool name -> schema + REST routing.
// buildManifest() iterates this and renders inputSchema via toJSONSchema().
// ---------------------------------------------------------------------------

interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  rest: McpToolRest;
}

const TOOL_DEFS: readonly ToolDef[] = [
  {
    name: "facts.gather",
    description:
      // TODO(ROLECALL-PLACEHOLDER): Wave-0 scaffold — facts.gather does not perform real fact gathering
      "Resolve the target hosts an inventory WOULD gather facts from. Returns the matched host list (actual fact gathering is Wave-0 scaffold). Body is an inline inventory (validated by InventorySchema) plus an optional limit.",
    schema: FactsGatherInputSchema,
    rest: {
      method: "POST",
      path: "/facts",
      params: [
        { name: "inventory", in: "body", required: true, description: "Inline inventory matching InventorySchema." },
        { name: "limit", in: "body", required: false, description: "Restrict to a single host pattern." },
      ],
    },
  },
  {
    name: "playbook.run",
    description:
      // TODO(ROLECALL-PLACEHOLDER): Wave-0 scaffold executor — no real remote state (dispatches to local run map only)
      "Enqueue a playbook|adhoc|nonIdempotent run. Wave-0 scaffold: plans/dispatches into the local run map only, it does not perform real remote state. Returns a stable runId for later status/replay.",
    schema: PlaybookRunInputSchema,
    rest: {
      method: "POST",
      path: "/run",
      params: [
        { name: "type", in: "body", required: true, description: "playbook | adhoc | nonIdempotent." },
        { name: "playbook", in: "body", required: false, description: "Inline playbook (PlaybookSchema)." },
        { name: "inventory", in: "body", required: false, description: "Inline inventory (InventorySchema)." },
        { name: "targets", in: "body", required: false, description: "Explicit target host names/patterns." },
        { name: "limit", in: "body", required: false, description: "Restrict targets to one pattern." },
        { name: "force", in: "body", required: false, description: "Force apply even if already in desired state." },
      ],
    },
  },
  {
    name: "playbook.diff",
    description:
      "Dry-run / --check a playbook. Maps to POST /run with check=true (and diff=true); returns a stable runId for later replay. No remote state is changed.",
    schema: PlaybookRunInputSchema,
    rest: {
      method: "POST",
      path: "/run",
      params: [
        { name: "type", in: "body", required: true, description: "playbook | adhoc | nonIdempotent." },
        { name: "check", in: "body", required: true, description: "Set true for diff/--check semantics." },
        { name: "playbook", in: "body", required: false, description: "Inline playbook (PlaybookSchema)." },
        { name: "inventory", in: "body", required: false, description: "Inline inventory (InventorySchema)." },
        { name: "targets", in: "body", required: false, description: "Explicit target host names/patterns." },
        { name: "limit", in: "body", required: false, description: "Restrict targets to one pattern." },
      ],
    },
  },
  {
    name: "run.replay",
    description:
      "Replay a stored run: re-emit its execution-trace ledger AND per-host/per-task performance profile. Enables failure-locality inspection without re-execution.",
    schema: RunIdInputSchema,
    rest: {
      method: "GET",
      path: "/runs/:id/trace",
      params: [{ name: "id", in: "path", required: true, description: "Run identifier." }],
      related: [{ method: "GET", path: "/runs/:id/profile" }],
    },
  },
  {
    name: "modules.search",
    description:
      "Search registered RoleCall modules by name or description substring (case-insensitive). Returns typed module summaries including idempotency metadata.",
    schema: ModulesSearchInputSchema,
    rest: {
      method: "GET",
      path: "/modules",
      params: [{ name: "q", in: "query", required: true, description: "Search term substring." }],
    },
  },
  {
    name: "docs.search",
    description:
      "Case-insensitive substring search over RoleCall's prose markdown docs under docs/content/**/*.md. Returns matched sections with their nearest heading, source line, and trimmed snippet.",
    schema: DocsSearchInputSchema,
    rest: {
      method: "GET",
      path: "/mcp/docs",
      params: [{ name: "q", in: "query", required: true, description: "Documentation search term." }],
    },
  },
  {
    name: "inventory.show",
    description:
      "Resolve an inventory into matched hosts + per-host vars (typed JSON). Supply a YAML file path or an inline JSON inventory.",
    schema: InventoryShowInputSchema,
    rest: {
      method: "GET",
      path: "/inventory",
      params: [
        { name: "path", in: "query", required: false, description: "Inventory YAML file path." },
        { name: "data", in: "query", required: false, description: "Inline JSON inventory (URL-encoded string)." },
      ],
    },
  },
  {
    name: "run.status",
    description:
      "Fetch a dispatched run's live record by id (status, counts, outcomes).",
    schema: RunIdInputSchema,
    rest: {
      method: "GET",
      path: "/runs/:id/status",
      params: [{ name: "id", in: "path", required: true, description: "Run identifier." }],
    },
  },
];

const MANIFEST_VERSION = "0.1.0";

/**
 * Build the full clientless agent manifest. The inputSchema of every tool is
 * generated from its Zod schema (reusing src/config/schema.ts), so the served
 * catalog can never drift from the validated data model.
 * @returns Discoverable agent tool manifest.
 */
export function buildManifest(): McpManifest {
  return {
    name: "rolecall-agent-surface",
    description:
      "Clientless REST agent surface for RoleCall orchestration. Discover tools via GET /mcp, then call the named endpoints with stock HTTP — no MCP SDK required.",
    transport: "http",
    version: MANIFEST_VERSION,
    endpoints: { manifest: { method: "GET", path: "/mcp" } },
    tools: TOOL_DEFS.map((def) => ({
      name: def.name,
      description: def.description,
      inputSchema: toJSONSchema(def.schema) as Record<string, unknown>,
      rest: def.rest,
    })),
  };
}

/** List the tool names present in the manifest (stable order). */
export function listToolNames(): readonly string[] {
  return TOOL_DEFS.map((d) => d.name);
}

/** Look up the Zod schema registered for a tool name (undefined if unknown). */
export function getToolSchema(name: string): z.ZodTypeAny | undefined {
  return TOOL_DEFS.find((d) => d.name === name)?.schema;
}

/**
 * Validate an agent tool call's input against its registered Zod schema. On
 * failure returns NAMED-FIELD errors (zod issue paths joined into a dotted
 * path) so a caller fails closed with a precise pointer to the bad field.
 * @param name Tool name (must be in the manifest).
 * @param value Parsed input for the tool.
 * @returns ok payload or a list of field errors.
 */
export function validateToolInput(name: string, value: unknown): ToolValidation {
  const def = TOOL_DEFS.find((d) => d.name === name);
  if (!def) {
    return { ok: false, errors: [{ path: "tool", message: `unknown tool '${name}'` }] };
  }
  const result = def.schema.safeParse(value);
  if (result.success) {
    return { ok: true, data: result.data as unknown };
  }
  return {
    ok: false,
    errors: result.error.issues.map((issue) => ({
      path: issue.path.join(".") || "(root)",
      message: issue.message,
    })),
  };
}

/** Re-export so route handlers / CLI can normalize without re-importing schema.ts. */
export { normalizeInventory };
export type { NormalizedInventory, RawInventory };
