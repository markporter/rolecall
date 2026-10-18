// In-process HTTP endpoint simulator for OFFLINE integration tests.
//
// Wraps Bun.serve so tests exercise the real transport client against a local
// endpoint with zero docker/lxc/podman. Supports GET/POST/PATCH returning JSON
// and enforces basic/token auth injection (mirrors src/transport/http.ts auth
// header handling used by the clients).
export interface HttpSimOptions {
  /** Fixed port to listen on (e.g. 39522); 0 = ephemeral. Default 39522. */
  port?: number;
  /** Bind address. Default "127.0.0.1". */
  hostname?: string;
  /** When set, requests must present matching creds else 401. Null disables. */
  auth?: BasicTokenAuth;
  /** Declarative router keyed by "METHOD /path"; first match wins. */
  routes?: Record<string, HttpRouteHandler>;
  /** Invoked when no route matches. Default 404 JSON. */
  fallback?: HttpFetchHandler;
  /** Health endpoint path checked by health(). Default "/health". */
  healthPath?: string;
  /** Body returned by the health endpoint. Default {"ok":true,"service":"http"}. */
  healthBody?: Record<string, unknown>;
}

/** Enforced auth schemes (subset of the client-side HttpAuth shapes). */
export type BasicTokenAuth =
  | { type: "basic"; user: string; pass: string }
  | { type: "token"; token: string };

export interface HttpRequestCtx {
  method: string;
  pathname: string;
  query: URLSearchParams;
  headers: Headers;
  authorization: string | null;
  json<T = unknown>(): Promise<T>;
  text(): Promise<string>;
}

// Accept any serializable object (interfaces without an index signature work too).
// Any resolvable result. Plain objects without an index signature are accepted
// because resolveResponse() serializes them via Response.json regardless of shape.
export type HttpRouteHandler = (
  req: Request,
  ctx: HttpRequestCtx,
) => unknown | Promise<unknown>;
export type HttpFetchHandler = HttpRouteHandler;

export interface HttpRequestSnapshot {
  method: string;
  pathname: string;
  authorization: string | null;
  bodyText: string | null;
}

export interface HttpSimHandle {
  url: string;
  port: number;
  baseUrl: string;
  healthUrl: string;
  /** Most recent request seen (for assertions like /whoami). */
  lastRequest(): HttpRequestSnapshot | null;
  /** Liveness probe hitting the health endpoint. */
  health(timeoutMs?: number): Promise<boolean>;
  close(): void;
}

const DEFAULT_PORT = 39522;

export async function createHttpSim(opts: HttpSimOptions = {}): Promise<HttpSimHandle> {
  const hostname = opts.hostname ?? "127.0.0.1";
  const port = opts.port ?? DEFAULT_PORT;
  const healthPath = opts.healthPath ?? "/health";
  const healthBody = opts.healthBody ?? { ok: true, service: "http" };
  const routes = opts.routes ?? {};
  const fallback = opts.fallback;
  const auth = opts.auth ?? null;

  let snapshot: HttpRequestSnapshot | null = null;
  let server: ReturnType<typeof Bun.serve> | null = null;

  await new Promise<void>((resolve, reject) => {
    const fetcher = async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      const p = url.pathname;

      if (p === healthPath) {
        return Response.json(healthBody);
      }

      // Auth enforcement mirrors what the clients expect to inject/receive.
      if (auth) {
        const received = req.headers.get("authorization") ?? "";
        const expected =
          auth.type === "basic"
            ? `Basic ${Buffer.from(`${auth.user}:${auth.pass}`).toString("base64")}`
            : `Bearer ${auth.token}`;
        if (received !== expected) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }
      }

      // Read the body exactly once (Bun rejects a second .text()/.json()).
      let bodyText = "";
      try {
        bodyText = await req.text();
      } catch {
        bodyText = "";
      }
      const ctx: HttpRequestCtx = {
        method: req.method,
        pathname: p,
        query: url.searchParams,
        headers: req.headers,
        authorization: req.headers.get("authorization"),
        json: <T = unknown>() => (bodyText ? (JSON.parse(bodyText) as T) : (undefined as unknown as T)),
        text: () => Promise.resolve(bodyText),
      };
      snapshot = { method: req.method, pathname: p, authorization: ctx.authorization, bodyText };
      const handler = routes[`${req.method} ${p}`] ?? routes[`${req.method} *`] ?? fallback;
      return resolveResponse(handler, req, ctx);
    };

    const srv = Bun.serve({ port, hostname, fetch: fetcher });
    server = srv;
    resolve();
  });

  // Derive the actually-bound port from the served URL so an ephemeral `port: 0`
  // request reports its real OS-assigned port rather than the requested placeholder.
  const actualPort = Number(new URL(server!.url).port);
  const base = `${new URL(server!.url).protocol}//${hostname}:${actualPort}`;

  return {
    url: server!.url.href,
    port: actualPort,
    baseUrl: base,
    healthUrl: `${base}${healthPath}`,
    lastRequest(): HttpRequestSnapshot | null {
      return snapshot;
    },
    async health(timeoutMs = 2000): Promise<boolean> {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(`${base}${healthPath}`, { signal: ctrl.signal });
        return res.ok && res.status < 300;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
    close(): void {
      try {
        server?.stop(true);
      } catch {
        /* already stopped */
      }
      server = null;
    },
  };
}

async function resolveResponse(
  handler: HttpRouteHandler | undefined,
  req: Request,
  ctx: HttpRequestCtx,
): Promise<Response> {
  if (!handler) return Response.json({ error: "not found" }, { status: 404 });
  const result = await handler(req, ctx);
  if (result instanceof Response) return result;
  if (result == null) return new Response("", { status: 200 });
  if (typeof result === "string") return new Response(result, { headers: { "content-type": "application/json" } });
  return Response.json(result);
}
