// Ansible response-shape parity: `slurp` exposes top-level content/content_base64
// and `http` accepts the `uri`-style status_code/return_content surface.
// Hermetic: slurp runs over a scripted Connection and http stubs globalThis.fetch
// with in-process Response objects (no network). Bun-only MVP (bun test).

import { afterEach, expect, test } from "bun:test";
import type { ModuleContext } from "../src/executor/module";
import type { ExecResult } from "../src/transport/connection";
import { createNoopConnection } from "../src/executor/context";
import { slurpModule } from "../src/modules/builtins/slurp";
import { httpModule, meta as httpMeta } from "../src/modules/builtins/http";

function context(
  connection: ModuleContext["connection"],
  args: Record<string, unknown>,
): ModuleContext {
  return { host: "h1", connection, args, vars: {}, facts: {}, reg: {} };
}

// --- slurp ------------------------------------------------------------------
test("slurp exposes content under both data.slurp and the top level", async () => {
  const text = "hello from slurp\n";
  const b64 = Buffer.from(text, "utf8").toString("base64");
  const calls: string[] = [];
  const conn = createNoopConnection("h1");
  conn.exec = async (cmd: string): Promise<ExecResult> => {
    calls.push(cmd);
    return { exitCode: 0, stdout: b64, stderr: "" };
  };

  const res = await slurpModule.run(context(conn, { src: "/etc/hostname" }));

  expect(res.changed).toBe(false);
  expect(res.failed ?? false).toBe(false);

  const slurp = res.data?.["slurp"] as
    | { content?: unknown; content_base64?: unknown }
    | undefined;
  expect(slurp?.content).toBe(text);
  expect(slurp?.content_base64).toBe(b64);

  expect(res.data?.["content"]).toBe(text);
  expect(res.data?.["content_base64"]).toBe(b64);

  const stdout = JSON.parse(String(res.stdout)) as {
    content?: unknown;
    content_base64?: unknown;
  };
  expect(stdout.content).toBe(text);
  expect(stdout.content_base64).toBe(b64);

  expect(calls.length).toBe(1);
  expect(calls[0]).toContain("/etc/hostname");
});

// --- http -------------------------------------------------------------------
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

type FetchRoute = (url: string, init?: RequestInit) => Response;

function stubFetch(route: FetchRoute): void {
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    return route(url, init);
  };
}

test("http status_code aliases expected_status, with expected_status winning", async () => {
  const calls: string[] = [];
  stubFetch((url, init) => {
    calls.push(`${(init?.method ?? "GET").toUpperCase()} ${url}`);
    return new Response("created", { status: 201 });
  });
  const conn = createNoopConnection("h1");

  const alias = await httpModule.run(
    context(conn, {
      url: "https://api.example.test/a",
      method: "POST",
      status_code: 201,
      force: true,
    }),
  );
  expect(alias.failed).toBe(false);

  const wins = await httpModule.run(
    context(conn, {
      url: "https://api.example.test/b",
      method: "POST",
      status_code: 500,
      expected_status: 201,
      force: true,
    }),
  );
  expect(wins.failed).toBe(false);

  const miss = await httpModule.run(
    context(conn, {
      url: "https://api.example.test/c",
      method: "POST",
      status_code: 500,
      force: true,
    }),
  );
  expect(miss.failed).toBe(true);
  expect(calls.length).toBe(3);
});

test("http return_content:true adds data.content and keeps stdout; safe stays unchanged", async () => {
  stubFetch(() => new Response("response-body", { status: 200 }));

  const res = await httpModule.run(
    context(createNoopConnection("h1"), {
      url: "https://api.example.test/read",
      method: "GET",
      return_content: true,
    }),
  );

  expect(res.changed).toBe(false);
  expect(res.failed).toBe(false);
  expect(res.data?.["content"]).toBe("response-body");
  expect(res.stdout).toBe("response-body");
});

test("http omits data.content by default", async () => {
  stubFetch(() => new Response("response-body", { status: 200 }));

  const res = await httpModule.run(
    context(createNoopConnection("h1"), {
      url: "https://api.example.test/read",
      method: "GET",
    }),
  );

  expect(res.changed).toBe(false);
  expect(res.data).toBeDefined();
  expect(res.data && "content" in res.data).toBe(false);
  expect(res.stdout).toBe("response-body");
});

test("http write methods converge only when not in desired state", async () => {
  let present = false;
  const calls: string[] = [];
  stubFetch((url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push(`${method} ${url}`);
    if (method === "GET") {
      return new Response(present ? "exists" : "missing", {
        status: present ? 200 : 404,
      });
    }
    if (method === "PUT") {
      present = true;
      return new Response("ok", { status: 200 });
    }
    return new Response("nope", { status: 405 });
  });

  const args = { url: "https://api.example.test/item", method: "PUT" };
  const first = await httpModule.run(context(createNoopConnection("h1"), args));
  expect(first.changed).toBe(true);
  expect(first.failed).toBe(false);

  const second = await httpModule.run(context(createNoopConnection("h1"), args));
  expect(second.changed).toBe(false);
  expect(second.data?.["idempotent"]).toBe(true);

  expect(calls).toEqual([
    "GET https://api.example.test/item",
    "PUT https://api.example.test/item",
    "GET https://api.example.test/item",
  ]);
});

test("http meta documents the status_code and return_content surface", () => {
  expect(httpMeta.args["status_code"]).toBeDefined();
  expect(httpMeta.args["return_content"]).toBeDefined();
  expect(String(httpMeta.notes)).not.toContain("no `status_code`/`return_content`");
});
