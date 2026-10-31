// Hermetic test for the P0 `tempfile` default-prefix fix: the generated mktemp
// command must use the `rolecall` prefix when `prefix` is not supplied. All OS
// work is routed through an in-memory scripted Connection (no network, no root).
// Bun-only MVP (bun test).

import { describe, expect, test } from "bun:test";
import type { Connection, ExecResult } from "../src/transport/connection";
import type { ModuleContext } from "../src/executor/module";
import { tempfileModule } from "../src/modules/builtins/tempfile";

const ok = (stdout = ""): ExecResult => ({ exitCode: 0, stdout, stderr: "" });

function ctxWith(conn: Connection, args: Record<string, unknown>): ModuleContext {
  return { host: "h1", connection: conn, args, vars: {}, facts: {}, registered: {} } as unknown as ModuleContext;
}

/** In-memory host that echoes a plausible temp path for any mktemp invocation. */
class TmpMem implements Connection {
  readonly kind = "local";
  readonly calls: string[] = [];

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async facts(): Promise<{ host: string; user: string; transport: "local" }> {
    return { host: "h1", user: "x", transport: "local" };
  }
  async health(): Promise<{ ok: boolean }> {
    return { ok: true };
  }
  async exec(command: string): Promise<ExecResult> {
    this.calls.push(command);
    return ok("/tmp/rolecall.XXXXXXXX");
  }
}

describe("tempfile default prefix", () => {
  test("uses the rolecall prefix when none is supplied", async () => {
    const conn = new TmpMem();
    const res = await tempfileModule.run(ctxWith(conn, {}));
    expect(res.changed).toBe(true);
    expect(conn.calls.length).toBe(1);
    expect(conn.calls[0]).toContain("rolecall");
    expect(conn.calls[0]).not.toContain("ansible");
  });

  test("an explicit prefix overrides the default", async () => {
    const conn = new TmpMem();
    await tempfileModule.run(ctxWith(conn, { prefix: "app-" }));
    expect(conn.calls[0]).toContain("app-");
    expect(conn.calls[0]).not.toContain("rolecall");
  });
});
