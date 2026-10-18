// HTTP webhook & REST run-trigger handlers (Todo 21).
//
// Accepts external payloads ({ type, ...jobFields }) to start orchestrator runs
// (playbook / ad-hoc / non-idempotent). Payload shape is validated STRICTLY
// BEFORE dispatch via src/orchestrator/job-validation.ts, so an invalid payload
// yields a structured 400 JSON WITHOUT ever touching the Engine. A valid payload
// reuses Engine.enqueue verbatim (same path as POST /run): every triggered run
// lands in the run map AND persists to the store, retrievable via GET /runs/:id/status.
// An optional single-token Bearer guard (ServerOptions.authToken) rejects
// unauthenticated requests with 401 when set; RBAC remains deferred. Mounted by
// routes.ts, which records each path into the shared 404/405 registry.

type Request = { headers: Record<string, string | string[] | undefined>; body: unknown };
type Response = { status(code: number): Response; json(body?: unknown): void };
type Handler = (req: Request, res: Response) => void;

interface AppLike {
  post(path: string, handler: (req: Request, res: Response) => void): unknown;
}

import type { Engine } from "./engine";
import { validateJobBody, type ValidationResult } from "./job-validation";

export interface WebhookRouteContext {
  engine: Engine;
  authToken?: string;
}

/** Open when token unset; else require exactly `Authorization: Bearer <token>`. */
function authorize(req: Request, token?: string): boolean {
  if (!token) return true;
  const raw = req.headers["authorization"];
  const provided = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
  return provided === `Bearer ${token}`;
}

/** Shared trigger used by both endpoints — mirrors POST /run's enqueue + envelope. Exported so routes.ts registers POST /webhook + /api/run through the single shared ROUTE_DEFINITIONS registry. */
export function handleTrigger(ctx: WebhookRouteContext): Handler {
  return (req, res): void => {
    if (!authorize(req, ctx.authToken)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const result: ValidationResult = validateJobBody(req.body);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    try {
      const id = ctx.engine.enqueue(result.value);
      res.status(202).json({ runId: id, status: "queued", type: result.type, self: `/runs/${id}/status` });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  };
}

/** Register POST /webhook + POST /api/run against the loose app surface. */
export function mountWebhooks(app: unknown, ctx: WebhookRouteContext, record: (method: string, path: string) => void): void {
  const api = app as unknown as AppLike;
  const trigger = handleTrigger(ctx);
  record("post", "/webhook");
  api.post("/webhook", trigger);
  record("post", "/api/run");
  api.post("/api/run", trigger);
}
