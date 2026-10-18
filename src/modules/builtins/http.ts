// Batteries-included idempotent HTTP/REST module (Todo 27).
//
// Performs an HTTP request directly from the RoleCall process (using the global
// `fetch`, available under Bun and Node 18+; `undici` is available if a custom
// dispatcher is needed later). Idempotency is intrinsic: `describe` (the
// CheckableModule `check`) probes the current state with a safe GET (or a
// caller-supplied `check_url`) and reports `inDesired` when the desired resource
// already exists / is absent per `state_present`. `converge` (the mutating
// request) only runs when `describe` reported not-in-desired, so re-running a
// `PUT`/`POST`/`PATCH` against an already-satisfied endpoint is a no-op.

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { CheckableModule } from "../../idempotency/types";
import { resource } from "../resource";
import type { ModuleSummary } from "../search";

/** Search metadata for the `http` module (auto-collected by builtins/index.ts). */
export const meta: ModuleSummary = {
  name: "http",
  description:
    "Idempotent HTTP/REST module: probes current state via GET (or check_url) and converges only when the desired state is absent.",
  idempotent: true,
  source: "builtin",
  args: {
    url: { type: "string", required: true, description: "Target URL." },
    method: {
      type: "string",
      required: false,
      description: "HTTP method (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS). Default GET.",
    },
    headers: {
      type: "Record<string, string>",
      required: false,
      description: "Request headers.",
    },
    body: {
      type: "unknown",
      required: false,
      description: "Request body (string verbatim, or JSON when json/non-string).",
    },
    json: {
      type: "boolean",
      required: false,
      description: "Serialize body as JSON when true or body is non-string.",
    },
    expected_status: {
      type: "number | number[]",
      required: false,
      description: "Acceptable status code(s); default any 2xx.",
    },
    check_url: {
      type: "string",
      required: false,
      description: "URL used by describe to probe state (defaults to url).",
    },
    state_present: {
      type: "boolean",
      required: false,
      description: "Expect resource present (true) or absent (false).",
    },
    match: {
      type: "unknown",
      required: false,
      description: "Substring or JSON value the probed body must match to be in-desired.",
    },
    timeout_seconds: {
      type: "number",
      required: false,
      description: "Per-request hard timeout in seconds.",
    },
  },
  examples: [
    `- http:
    url: https://api.example.com/items/42
    method: PUT
    state_present: true
    headers:
      Authorization:
        $concat:
          - 'Bearer '
          - $var: vars.api_token
    body:
      name: widget
      region:
        $var: vars.site_region
    json: true`,
    `- http:
    url: https://api.example.com/deploy
    method: POST
    body:
      event: deploy
      wait_for_healthy:
        $if:
          then: true
          else: false
          condition:
            $eq:
              - $var: vars.health
              - ready
    json: true`,
    `- http:
    url: https://api.example.com/items/42
    method: DELETE
    state_present: false`,
  ],
  notes:
    "≠ Ansible `uri`: `describe` probes current state with a safe GET (or `check_url`) and only converges when the desired state is absent, so PUT/POST/PATCH are idempotent by default. There is no `status_code`/`return_content` nesting — use `match` + `expected_status`. Safe methods (GET/HEAD/OPTIONS) never report changed.",
};

interface HttpArgs {
  /** Target URL. Required. */
  url: string;
  /** HTTP method (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS). Default GET. */
  method?: string;
  /** Request headers. */
  headers?: Record<string, string>;
  /** Request body (string sent verbatim; object sent as JSON when `json`/non-string). */
  body?: unknown;
  /** When true (or when `body` is a non-string), serialize `body` as JSON. */
  json?: boolean;
  /** Acceptable status code(s); default any 2xx. */
  expected_status?: number | number[];
  /** URL used by `describe` to probe current state (defaults to `url`). */
  check_url?: string;
  /** For write methods: expect the resource present (true) or absent (false). */
  state_present?: boolean;
  /** Optional substring or JSON value that the probed body must match to be in-desired. */
  match?: unknown;
  /** Per-request hard timeout in seconds. */
  timeout_seconds?: number;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function statusMatches(status: number, expected: number | number[] | undefined): boolean {
  if (expected === undefined) return status >= 200 && status < 300;
  return Array.isArray(expected)
    ? expected.includes(status)
    : status === expected;
}

function bodyToSend(a: HttpArgs): { body?: string; headers: Record<string, string> } {
  const headers = { ...(a.headers ?? {}) };
  if (a.body === undefined) return { headers };
  if (a.json || typeof a.body !== "string") {
    return {
      body: JSON.stringify(a.body),
      headers: {
        ...headers,
        "content-type": headers["content-type"] ?? "application/json",
      },
    };
  }
  return { body: String(a.body), headers };
}

async function fetchText(
  a: HttpArgs,
  url: string,
  method: string,
): Promise<{ status: number; body: string }> {
  const res = await fetch(url, {
    method,
    headers: a.headers,
    body: method === "GET" || method === "HEAD" ? undefined : bodyToSend(a).body,
    signal: a.timeout_seconds ? AbortSignal.timeout(a.timeout_seconds * 1000) : undefined,
  });
  const body = await res.text();
  return { status: res.status, body };
}

/** Subset/equality match of `actual` against an expected JSON `match` value. */
function bodyMatches(actual: string, match: unknown): boolean {
  if (match === undefined) return true;
  if (typeof match === "string") return actual.includes(match);
  try {
    const parsed = JSON.parse(actual) as unknown;
    return (
      JSON.stringify(parsed) === JSON.stringify(match) ||
      isSubset(parsed, match)
    );
  } catch {
    return false;
  }
}

function isSubset(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== "object") {
    return actual === expected;
  }
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      expected.length === actual.length &&
      expected.every((e, i) => isSubset(actual[i], e))
    );
  }
  if (typeof actual !== "object" || actual === null) return false;
  return Object.entries(expected as Record<string, unknown>).every(([k, v]) =>
    isSubset((actual as Record<string, unknown>)[k], v),
  );
}

/** @summary Idempotent HTTP/REST module: `describe` probes state via GET (or `check_url`), `converge` issues the mutating request. Safe methods (GET/HEAD/OPTIONS) are read-only and report changed:false. @param args HttpArgs (url, method, body, headers, expected_status, check_url, state_present, match). @returns Module & CheckableModule. */
export const httpModule: Module & CheckableModule = resource({
  name: "http",
  async describe(args) {
    const a = args as unknown as HttpArgs;
    const url = String(a.url ?? "");
    if (!url) return { current: null, inDesired: false };
    const method = String(a.method ?? "GET").toUpperCase();
    if (SAFE_METHODS.has(method)) {
      const st = await fetchText(a, url, method);
      return {
        current: { status: st.status, body: st.body.slice(0, 500) },
        inDesired: statusMatches(st.status, a.expected_status ?? 200),
      };
    }
    const checkUrl = a.check_url ?? url;
    const st = await fetchText(a, checkUrl, "GET");
    const present = statusMatches(st.status, 200);
    const wantPresent = a.state_present ?? true;
    const inDesired = wantPresent
      ? present && bodyMatches(st.body, a.match)
      : !present;
    return {
      current: { status: st.status, present, body: st.body.slice(0, 500) },
      inDesired,
    };
  },
  async converge(args) {
    const a = args as unknown as HttpArgs;
    const url = String(a.url ?? "");
    if (!url) {
      return { changed: false, failed: true, msg: "http: 'url' is required" };
    }
    const method = String(a.method ?? "GET").toUpperCase();
    const { body, headers } = bodyToSend(a);
    const res = await fetch(url, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : body,
      signal: a.timeout_seconds ? AbortSignal.timeout(a.timeout_seconds * 1000) : undefined,
    });
    const text = await res.text();
    const ok = statusMatches(res.status, a.expected_status);
    const safe = SAFE_METHODS.has(method);
    return {
      changed: !safe,
      failed: !ok,
      stdout: text.slice(0, 1000),
      msg: `http ${method} ${url} -> ${res.status}`,
      data: { url, method, status: res.status },
    };
  },
});

(httpModule as Module & CheckableModule & { meta: ModuleSummary }).meta = meta;
