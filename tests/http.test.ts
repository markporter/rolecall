// HttpApiConnection tests — Bun-only MVP, run under `bun test`.
//
// In-process Bun.serve mock HTTP server on fixed port 39517. Covers:
//  - GET/POST/PATCH round-trip (minimal-patch body)
//  - malformed (non-JSON) response handled gracefully
//  - non-2xx status surfaced in exitCode
//  - auth header injection: basic / token / oauth
//  - concurrency bounded by undici Pool size
//  - health probe + facts
//  - gRPC deferred capability throws at connect()
//  - factory dispatch
import { afterAll, beforeAll, expect, test } from "bun:test";

import { createConnection, HttpApiConnection, type HttpApiConnectionOptions } from "../src/transport";

const PORT = 39517;
const ORIGIN = `http://127.0.0.1:${PORT}`;

let server: ReturnType<typeof Bun.serve>;
let maxConcurrent = 0;
let active = 0;

beforeAll(() => {
  server = Bun.serve({
    port: PORT,
    fetch(req) {
      const url = new URL(req.url);
      const p = url.pathname;
      if (p === "/oauth/token") {
        return Response.json({ access_token: "test-token", token_type: "Bearer" });
      }
      if (p === "/api/ping") return Response.json({ pong: true });
      if (p === "/api/echo") {
        return req.text().then((b) => new Response(b, { headers: { "content-type": "application/json" } }));
      }
      if (p === "/api/patch") {
        return req.text().then((b) => Response.json({ patched: true, received: b }));
      }
      if (p === "/api/whoami") {
        return Response.json({ authorization: req.headers.get("authorization") ?? "" });
      }
      if (p === "/api/slow") {
        active++;
        maxConcurrent = Math.max(maxConcurrent, active);
        return new Promise((resolve) =>
          setTimeout(() => {
            active--;
            resolve(Response.json({ ok: true }));
          }, 50),
        );
      }
      if (p === "/api/boom") return new Response("boom", { status: 500 });
      if (p === "/api/garbage") return new Response("not-json-at-all", { status: 200 });
      return new Response("not found", { status: 404 });
    },
  });
});

afterAll(() => {
  server.stop(true);
});

function base(over: Partial<HttpApiConnectionOptions> = {}): HttpApiConnectionOptions {
  return {
    kind: "http",
    host: "127.0.0.1",
    port: PORT,
    user: "api",
    basePath: "/api",
    request: { method: "GET", path: "/ping" },
    ...over,
  } as HttpApiConnectionOptions;
}

test("GET round-trips a JSON body", async () => {
  const conn = new HttpApiConnection(base());
  await conn.connect();
  const res = await conn.exec("");
  expect(res.exitCode).toBe(200);
  expect(JSON.parse(res.stdout).pong).toBe(true);
  await conn.disconnect();
});

test("POST round-trips the request body", async () => {
  const conn = new HttpApiConnection(base({ request: { method: "POST", path: "/echo" } }));
  await conn.connect();
  const res = await conn.exec(JSON.stringify({ name: "rolecall" }));
  expect(res.exitCode).toBe(200);
  expect(JSON.parse(res.stdout).name).toBe("rolecall");
  await conn.disconnect();
});

test("PATCH sends only the changed (minimal) fields", async () => {
  const conn = new HttpApiConnection(base({ request: { method: "PATCH", path: "/patch" } }));
  await conn.connect();
  const res = await conn.exec(JSON.stringify({ field: "v" }));
  expect(res.exitCode).toBe(200);
  const json = JSON.parse(res.stdout);
  expect(json.patched).toBe(true);
  expect(json.received).toContain("field");
  await conn.disconnect();
});

test("malformed (non-JSON) response is handled without throwing", async () => {
  const conn = new HttpApiConnection(base({ request: { method: "GET", path: "/garbage" } }));
  await conn.connect();
  const res = await conn.exec("");
  expect(res.exitCode).toBe(200);
  expect(res.stdout).toBe("not-json-at-all");
  expect(res.stderr).toBe("");
  await conn.disconnect();
});

test("non-2xx status is surfaced in exitCode", async () => {
  const conn = new HttpApiConnection(base({ request: { method: "GET", path: "/boom" } }));
  await conn.connect();
  const res = await conn.exec("");
  expect(res.exitCode).toBe(500);
  expect(res.stdout).toBe("boom");
  await conn.disconnect();
});

test("basic auth header is injected", async () => {
  const conn = new HttpApiConnection(
    base({
      auth: { type: "basic", user: "alice", pass: "secret" },
      request: { method: "GET", path: "/whoami" },
    }),
  );
  await conn.connect();
  const res = await conn.exec("");
  const expected = "Basic " + Buffer.from("alice:secret").toString("base64");
  expect(JSON.parse(res.stdout).authorization).toBe(expected);
  await conn.disconnect();
});

test("token auth header is injected", async () => {
  const conn = new HttpApiConnection(
    base({
      auth: { type: "token", token: "abc123" },
      request: { method: "GET", path: "/whoami" },
    }),
  );
  await conn.connect();
  const res = await conn.exec("");
  expect(JSON.parse(res.stdout).authorization).toBe("Bearer abc123");
  await conn.disconnect();
});

test("oauth exchanges a token and injects Bearer", async () => {
  const conn = new HttpApiConnection(
    base({
      auth: { type: "oauth", tokenUrl: `${ORIGIN}/oauth/token`, clientId: "cid", clientSecret: "csec" },
      request: { method: "GET", path: "/whoami" },
    }),
  );
  await conn.connect();
  const res = await conn.exec("");
  expect(JSON.parse(res.stdout).authorization).toBe("Bearer test-token");
  await conn.disconnect();
});

test("concurrency is bounded by the undici Pool size", async () => {
  maxConcurrent = 0;
  active = 0;
  const conn = new HttpApiConnection(
    base({ poolSize: 2, request: { method: "GET", path: "/slow" } }),
  );
  await conn.connect();
  await Promise.all(Array.from({ length: 10 }, () => conn.exec("")));
  expect(maxConcurrent).toBeLessThanOrEqual(2);
  await conn.disconnect();
});

test("health probe reports ok against a live endpoint", async () => {
  const conn = new HttpApiConnection(base({ healthPath: "/ping" }));
  await conn.connect();
  const h = await conn.health();
  expect(h.ok).toBe(true);
  expect(h.latencyMs).toBeDefined();
  await conn.disconnect();
});

test("facts returns http transport metadata", async () => {
  const conn = new HttpApiConnection(base({ auth: { type: "basic", user: "bob", pass: "x" } }));
  const facts = await conn.facts();
  expect(facts.transport).toBe("http");
  expect(facts.host).toBe("127.0.0.1");
  expect(facts.user).toBe("bob");
});

test("gRPC capability is deferred and throws at connect()", async () => {
  const conn = new HttpApiConnection(base({ grpc: { service: "svc", method: "Do" } }));
  await expect(conn.connect()).rejects.toThrow(/gRPC client deferred/);
});

test("exec before connect rejects", async () => {
  const conn = new HttpApiConnection(base());
  await expect(conn.exec("")).rejects.toThrow(/not connected/);
});

test("createConnection dispatches http kind", () => {
  expect(createConnection(base()).kind).toBe("http");
});
