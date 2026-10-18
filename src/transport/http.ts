// HttpApiConnection — REST transport for API-managed targets (Todo 11).
//
// Maps HTTP semantics onto the Connection contract:
//   connect()  resolves an OAuth token if configured (idempotent)
//   exec()     issues the configured request; `command` is the JSON request
//              body (the caller supplies ONLY the changed fields — minimal patch)
//   facts()    returns endpoint metadata
//   health()   GET liveness probe against healthPath
//   disconnect() clears auth state
//
// Auth: basic (user:pass → Basic), token (Bearer), oauth (client-credentials
// exchange → Bearer). gRPC is a deferred capability (throws at connect()).
//
// NOTE on the HTTP client: the task specified undici `Pool` (pin >=8.5.0). Under
// Bun 1.3.14 the installed undici v8 fails to load (webidl.markAsUncloneable
// missing) and Bun's built-in `undici` shim exposes a non-functional `Pool`. We
// therefore use Bun's undici-backed global `fetch` and bound concurrency with
// p-limit (the same primitive the resilient runner uses) to honor the "pool size
// bounds in-flight requests" requirement. No new dependencies are added.
import {
  type Connection,
  type ConnectionFacts,
  type CoreExec,
  createResilientRunner,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_TIMEOUT_MS,
  type ExecOptions,
  type ExecResult,
  type HealthStatus,
  type HttpApiConnectionOptions,
} from "./connection";

const DEFAULT_POOL_SIZE = 10;
const HEALTH_TIMEOUT_MS = 5_000;

export class HttpApiConnection implements Connection {
  readonly kind = "http" as const;
  readonly options: HttpApiConnectionOptions;

  #origin: string;
  #bearer: string | null = null;
  #connected = false;
  #runner: (core: CoreExec, options?: ExecOptions) => Promise<ExecResult>;

  constructor(options: HttpApiConnectionOptions) {
    this.options = options;
    const port = options.port ?? 80;
    this.#origin = `http://${options.host}:${port}`;
    // poolSize bounds concurrent in-flight requests (the Pool analogue).
    this.#runner = createResilientRunner({
      concurrency: options.poolSize ?? DEFAULT_POOL_SIZE,
      retry: { ...DEFAULT_RETRY_CONFIG, ...(options.retry ?? { retries: 0 }) },
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
  }

  async connect(): Promise<void> {
    if (this.#connected) return;
    if (this.options.grpc) {
      // TODO(ROLECALL-PLACEHOLDER): gRPC client deferred — install nice-grpc/connect-es
      throw new Error("gRPC client deferred — install nice-grpc/connect-es");
    }
    if (this.options.auth?.type === "oauth") {
      this.#bearer = await this.#exchangeOAuth();
    }
    this.#connected = true;
  }

  async #exchangeOAuth(): Promise<string> {
    const a = this.options.auth;
    if (!a || a.type !== "oauth") throw new Error("HttpApiConnection: not oauth");
    const res = await fetch(a.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: a.clientId,
        client_secret: a.clientSecret,
        ...(a.scope ? { scope: a.scope } : {}),
      }),
    });
    if (!res.ok) throw new Error(`OAuth token exchange failed: ${res.status}`);
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) throw new Error("OAuth response missing access_token");
    return json.access_token;
  }

  #authHeaders(): Record<string, string> {
    const a = this.options.auth;
    if (!a) return {};
    if (a.type === "basic") {
      const b64 = Buffer.from(`${a.user}:${a.pass}`).toString("base64");
      return { authorization: `Basic ${b64}` };
    }
    if (a.type === "token") return { authorization: `Bearer ${a.token}` };
    return { authorization: `Bearer ${this.#bearer ?? ""}` };
  }

  #fullPath(path: string): string {
    const base = (this.options.basePath ?? "").replace(/\/$/, "");
    const p = path.startsWith("/") ? path : `/${path}`;
    return `${base}${p}`;
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    if (!this.#connected) throw new Error("HttpApiConnection: not connected");
    return this.#runner((signal) => this.#rawExec(command, signal), options);
  }

  async #rawExec(command: string, signal: AbortSignal): Promise<ExecResult> {
    const req = this.options.request;
    const hasBody = req.method !== "GET" && req.method !== "DELETE";
    const body = hasBody && command ? command : undefined;
    const headers: Record<string, string> = { ...this.#authHeaders(), ...(req.headers ?? {}) };
    if (hasBody && !("content-type" in headers)) headers["content-type"] = "application/json";
    try {
      const res = await fetch(`${this.#origin}${this.#fullPath(req.path)}`, {
        method: req.method,
        headers,
        body,
        signal,
      });
      const text = await res.text();
      return { exitCode: res.status, stdout: text, stderr: "" };
    } catch (err) {
      // Network-level failure (refused/reset/timeout): rethrow so the resilient
      // runner can apply its timeout/retry policy.
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  async facts(): Promise<ConnectionFacts> {
    const a = this.options.auth;
    const user = a?.type === "basic" ? a.user : this.options.user;
    return { host: this.options.host, user: user || "api", transport: "http" };
  }

  async health(): Promise<HealthStatus> {
    const start = Date.now();
    if (!this.#connected) {
      return { ok: false, error: "not connected", latencyMs: Date.now() - start };
    }
    const path = this.#fullPath(this.options.healthPath ?? this.options.request.path);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("timeout")), HEALTH_TIMEOUT_MS);
    const t = timer as unknown as { unref?: () => void };
    if (typeof t.unref === "function") t.unref();
    try {
      const res = await fetch(`${this.#origin}${path}`, {
        method: "GET",
        headers: this.#authHeaders(),
        signal: controller.signal,
      });
      const ok = res.status >= 200 && res.status < 400;
      return { ok, latencyMs: Date.now() - start };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - start,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async disconnect(): Promise<void> {
    this.#connected = false;
    this.#bearer = null;
  }
}
