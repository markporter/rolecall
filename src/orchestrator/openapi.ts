// Generated OpenAPI 3.0 builder for the RoleCall orchestrator server.
//
// Single consumer of src/orchestrator/routes.ts::ROUTE_DEFINITIONS — the same array
// BOTH mountRoutes() (HTTP mount) and this builder iterate, so the emitted spec's
// {method, path} set cannot drift from the actually-mounted endpoints. Every paths
// key uses the literal Express pattern (e.g. "/runs/:id/status") so it matches the
// mounted route strings byte-for-byte.
//
// Pure static output: no runtime dependency on swagger-ui-express or any OpenAPI
// typings package. Mounting Swagger UI over HTTP lives in a later component (C10).

import { ROUTE_DEFINITIONS, type RouteDefinition } from "./routes";

interface ContentObject {
  [mediaType: string]: { schema?: Record<string, unknown>; example?: unknown };
}

interface ResponseObject {
  description: string;
  content?: ContentObject;
}

type ParameterObject = { name: string; in: string; required?: boolean; description?: string; schema?: Record<string, unknown> };

interface OperationObject {
  summary?: string;
  description?: string;
  tags?: string[];
  operationId?: string;
  security?: Array<Record<string, readonly []>>;
  parameters?: ParameterObject[];
  requestBody?: { content: ContentObject };
  responses: Record<string, ResponseObject>;
}

interface PathItemObject {
  summary?: string;
  description?: string;
  get?: OperationObject;
  post?: OperationObject;
  put?: OperationObject;
  delete?: OperationObject;
}

/** Minimal subset of the OpenAPI 3.0 Document shape needed to serve the raw spec. Typed loosely (no external openapi typings dependency). */
export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers?: Array<{ url: string; description: string }>;
  paths: Record<string, PathItemObject>;
  components?: {
    securitySchemes?: Record<string, { type: "http"; scheme: "bearer"; description: string }>;
  };
}

/** Fold one RouteDefinition into an OpenAPI operation object, preserving honest scaffold caveats. */
function operationFor(def: RouteDefinition): OperationObject {
  const op: OperationObject = {
    summary: def.summary,
    ...(def.description ? { description: def.description } : {}),
    ...(def.group ? { tags: [def.group] } : {}),
    responses: def.responses ?? {},
  };
  if (def.parameters && def.parameters.length > 0) op.parameters = [...def.parameters];
  if (def.security && def.security.length > 0) op.security = def.security;
  if (def.requestBody) op.requestBody = def.requestBody;
  return op;
}

/**
 * Build an OpenAPI 3.0 document whose `paths` mirror ROUTE_DEFINITIONS exactly.
 * The returned object is safe to JSON-serialize and served verbatim at `/docs.json`.
 */
export function buildOpenApi(): OpenApiDocument {
  const paths: Record<string, PathItemObject> = {};
  for (const def of ROUTE_DEFINITIONS) {
    let item = paths[def.path];
    if (!item) { item = {}; paths[def.path] = item; }
    item[def.method] = operationFor(def);
  }
  return {
    openapi: "3.0.3",
    info: {
      title: "RoleCall Orchestrator API",
      version: "0.1.0",
      description:
        // TODO(ROLECALL-PLACEHOLDER): REST surface scaffolded (not yet implemented): scheduler/cron/webhooks/RBAC
        "REST surface served by `rolecall --serve`. Executor, transport, and structured templating are implemented; scheduler / cron / webhooks / SPA UI route registry and RBAC remain scaffolded (\"not yet implemented\"). See individual descriptions for honest caveats.",
    },
    servers: [{ url: "/", description: "Local orchestrator HTTP server" }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description:
            "Optional single-token Bearer guard (Todo 21). Present-but-limited: when ServerOptions.authToken is unset every trigger accepts requests; RBAC remains deferred.",
        },
      },
    },
  };
}
