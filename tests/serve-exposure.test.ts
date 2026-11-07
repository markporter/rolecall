import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createServer, isLoopbackHost, serveExposureProblem, startServe, type ServerHandle } from "../src/orchestrator";
import { openStore } from "../src/store";

const dirs: string[] = [];
const handles: ServerHandle[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.closeDrain();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "rolecall-exposure-"));
  dirs.push(dir);
  return dir;
}

describe("serve exposure gate", () => {
  test("loopback is the only implicit allow", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("10.0.0.5")).toBe(false);
  });

  test("non-loopback requires --exposed and a token", () => {
    expect(serveExposureProblem({ hostname: "0.0.0.0" })).toContain("without --exposed");
    expect(serveExposureProblem({ hostname: "0.0.0.0", exposed: true })).toContain("without a Bearer token");
    expect(serveExposureProblem({ hostname: "0.0.0.0", exposed: true, token: "tok" })).toBeUndefined();
    expect(serveExposureProblem({ hostname: "127.0.0.1" })).toBeUndefined();
    expect(serveExposureProblem({ hostname: "127.0.0.1", exposed: true })).toContain("without a Bearer token");
    expect(serveExposureProblem({ hostname: "0.0.0.0", exposed: true, allowAnonymous: true })).toBeUndefined();
  });

  test("exposed mode authenticates every route except /health", async () => {
    const store = openStore({ dbPath: join(tmp(), "state.db") });
    const handle = await createServer({
      port: 0,
      hostname: "127.0.0.1",
      store,
      noSignalHandlers: true,
      exposed: true,
      authToken: "secret-token",
    });
    handles.push(handle);

    const health = await fetch(`${handle.baseUrl}/health`);
    expect(health.status).toBe(200);

    const open = await fetch(`${handle.baseUrl}/status`);
    expect(open.status).toBe(401);

    const wrong = await fetch(`${handle.baseUrl}/status`, { headers: { Authorization: "Bearer nope" } });
    expect(wrong.status).toBe(401);

    const ok = await fetch(`${handle.baseUrl}/status`, { headers: { Authorization: "Bearer secret-token" } });
    expect(ok.status).toBe(200);
  });

  test("startServe refuses a non-loopback bind before listening", async () => {
    const code = await startServe(["--serve", "--host", "0.0.0.0", "--port", "0"], { noSignalHandlers: true });
    expect(code).toBe(1);
  });

  test("createServer refuses exposed mode without a token", async () => {
    const store = openStore({ dbPath: join(tmp(), "state.db") });
    await expect(
      createServer({ port: 0, hostname: "127.0.0.1", store, noSignalHandlers: true, exposed: true }),
    ).rejects.toThrow(/requires a Bearer token/);
  });
});
