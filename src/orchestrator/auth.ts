// Bearer-token authentication shared by exposed serve mode and the trigger routes.
//
// ADR 0023/0027: a single shared Bearer token is the floor for non-loopback
// serving. Comparison is constant-time; a missing configured token means open
// mode (loopback only), which the serve entrypoint enforces separately.

import { timingSafeEqual } from "node:crypto";

type Headers = Record<string, string | string[] | undefined>;

type AuthRequest = { url?: string; headers?: Headers };
type AuthResponse = { status(code: number): { json(body?: unknown): void } };
type Next = () => void;

/** @summary Read the first `Authorization` header value from a loosely-typed request. @param headers Request headers map. @returns The header value, or an empty string when absent. */
export function authorizationHeader(headers: Headers | undefined): string {
  const raw = headers?.["authorization"];
  return Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
}

/** @summary Constant-time check of an `Authorization: Bearer <token>` value. @param header Raw Authorization header value. @param token Configured token; when unset the endpoint is open and this returns true. @returns True when the header matches the configured token (or no token is configured). */
export function bearerMatches(header: string | undefined, token: string | undefined): boolean {
  if (!token) return true;
  if (!header || !header.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(token);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

/** @summary Build Express middleware that requires the Bearer token on every path except `/health`. Used only when `--exposed` is active. @param token Configured Bearer token. @returns Middleware enforcing `Authorization: Bearer <token>`. */
export function makeExposedAuthMiddleware(token: string): (req: AuthRequest, res: AuthResponse, next: Next) => void {
  return (req, res, next): void => {
    const path = (req.url ?? "").split("?")[0] ?? "";
    if (path === "/health" || path === "/health/") {
      next();
      return;
    }
    if (!bearerMatches(authorizationHeader(req.headers), token)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}
