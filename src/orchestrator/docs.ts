// Swagger UI + raw OpenAPI spec serving for the RoleCall orchestrator server (C10).
//
// Two ADDITIVE routes wired inside src/orchestrator/routes.ts::mountRoutes(), AFTER the
// liveness endpoints (/,/health,/ping,/status) and BEFORE the terminal 404/405/error
// middlewares:
//   * GET /docs.json -> the OpenAPI 3.0 document produced by buildOpenApi() (one-shot read
//     of ROUTE_DEFINITIONS); served verbatim as application/json, HTTP 200.
//   * GET /docs      -> Swagger UI pointing at /docs.json.
//
// Reuses buildOpenApi() verbatim — never hand-copies a second spec copy. Pure HTTP wiring:
// no handler body or return shape under src/orchestrator changes. These doc endpoints stay
// UNAUTHENTICATED on purpose so they remain reachable during development without a bearer
// token (the optional `authToken` guard governs the run-trigger endpoints, not the docs).

import { buildOpenApi } from "./openapi";
import type { OpenApiDocument } from "./openapi";
import swaggerUi from "swagger-ui-express";

// Local request/response shapes mirroring src/orchestrator/routes.ts so these names resolve
// WITHOUT requiring @types/express; the concrete Express Request/Response arrive via the loose
// ambient shim, so matching this exact structure keeps the passed-in handlers assignable.
type Request = { method: string; url: string; params: Record<string, string>; query: unknown; headers: Record<string, string | string[] | undefined>; body: unknown };
type Response = { headersSent?: boolean; status(code: number): Response; json(body?: unknown): void; send(body?: unknown): void; set(field: string, value: string): Response };

/** Minimal app surface needed to register the docs routes below. Loose on purpose (see express.d.ts). */
interface DocsApp {
  get(path: string, handler: (req: Request, res: Response) => unknown): void;
  use(...middleware: unknown[]): void;
}

/** Optional knobs for mountDocs(); every field degrades to a sensible default. */
export interface DocsMountOptions {
  /** Title shown in the Swagger UI browser tab / header. */
  customSiteTitle?: string;
}

/**
 * Register GET /docs.json (raw OpenAPI 3.0) plus Swagger UI mounted at /docs.
 * Additive and side-effect free beyond mounting; returns the paths/methods registered so
 * the caller can record them into its known-path registry (keeps 404-vs-405 tail honest).
 */
export function mountDocs(app: DocsApp, opts: DocsMountOptions = {}): ReadonlyArray<{ method: string; path: string }> {
  const spec: OpenApiDocument = buildOpenApi();
  const siteTitle = opts.customSiteTitle ?? "RoleCall Orchestrator API";

  // Raw spec endpoint: deterministic JSON, never falls through to the 404/405 tail.
  app.get("/docs.json", (_req: Request, res: Response): void => {
    res.status(200).json(spec);
  });

  // Swagger UI bundle + assets behind /docs. serve is an array of [init, static-asset] middlewares;
  // spread them so each runs in order, followed by setup() rendering the HTML entry page.
  app.use("/docs", ...swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: siteTitle }));

  return [
    { method: "get", path: "/docs.json" },
    { method: "get", path: "/docs" },
  ];
}
