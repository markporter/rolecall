// Hermetic tests for `wait_for` Ansible-parity work: `state` (started/present/
// stopped/absent/drained) and `search_regex` on path/port probes. All remote work
// is routed through an in-memory scripted Connection (no network, no real sleeps
// beyond a single immediate first-probe success). Bun-only MVP (bun test).

import { describe, expect, test } from "bun:test";
import type { Connection, ExecResult } from "../src/transport/connection";
import type { ModuleContext } from "../src/executor/module";
import { waitForModule } from "../src/modules/builtins/wait_for";

const ok = (stdout = ""): ExecResult => ({ exitCode: 0, stdout, stderr: "" });
const fail = (stderr = ""): ExecResult => ({ exitCode: 1, stdout: "", stderr });

class ScriptedConnection implements Connection {
  readonly kind = "local";
  readonly calls: string[] = [];
  constructor(private readonly respond: (cmd: string) => ExecResult) {}

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async facts() {
    return { host: "h1", user: "ci", transport: "local" as const };
  }
  async health() {
    return { ok: true };
  }
  async exec(command: string): Promise<ExecResult> {
    this.calls.push(command);
    return this.respond(command);
  }
}

function ctx(conn: Connection, args: Record<string, unknown>): ModuleContext {
  return { host: "h1", connection: conn, args, vars: {}, facts: {}, reg: {} };
}

describe("wait_for path + search_regex", () => {
  test("succeeds when the combined test/grep probe exits 0", async () => {
    const path = "/tmp/rolecall-wait.pid";
    const probe = `test -e '${path}' && grep -q -E '^[0-9]+$' '${path}'`;
    const conn = new ScriptedConnection((cmd) => {
      if (cmd === probe) return ok();
      throw new Error(`unexpected command: ${cmd}`);
    });

    const res = await waitForModule.run(
      ctx(conn, { path, search_regex: "^[0-9]+$", timeout: 5 }),
    );

    expect(res.failed ?? false).toBe(false);
    expect(res.changed).toBe(false);
    expect(res.msg).toBe(`wait_for: ${path} matches ^[0-9]+$`);
    expect(conn.calls).toContain(probe);
  });

  test("fails immediately with timeout:0 when the probe exits 1", async () => {
    const path = "/tmp/rolecall-wait.pid";
    const probe = `test -e '${path}' && grep -q -E '^[0-9]+$' '${path}'`;
    const conn = new ScriptedConnection((cmd) => {
      if (cmd === probe) return fail();
      throw new Error(`unexpected command: ${cmd}`);
    });

    const res = await waitForModule.run(
      ctx(conn, { path, search_regex: "^[0-9]+$", timeout: 0 }),
    );

    expect(res.changed).toBe(false);
    expect(res.failed).toBe(true);
    expect(String(res.msg)).toContain("did not match");
    expect(conn.calls).toContain(probe);
  });
});

describe("wait_for port + search_regex", () => {
  test("probes the socket output through bash /dev/tcp and greps it", async () => {
    const probe =
      "timeout 1 bash -c 'cat < /dev/tcp/127.0.0.1/8000' 2>/dev/null | grep -q -E 'OK'";
    const conn = new ScriptedConnection((cmd) => {
      if (cmd === probe) return ok();
      throw new Error(`unexpected command: ${cmd}`);
    });

    const res = await waitForModule.run(
      ctx(conn, { port: 8000, search_regex: "OK", timeout: 5 }),
    );

    expect(res.failed ?? false).toBe(false);
    expect(res.msg).toBe("wait_for: 127.0.0.1:8000 output matches OK");
    expect(conn.calls).toContain(probe);
  });
});

describe("wait_for stopped/absent state", () => {
  test("state:stopped succeeds when the port probe is closed", async () => {
    const conn = new ScriptedConnection((cmd) => {
      if (cmd === "exec 3<>/dev/tcp/'127.0.0.1'/8080 2>/dev/null && exec 3>&-") return fail();
      throw new Error(`unexpected command: ${cmd}`);
    });

    const res = await waitForModule.run(ctx(conn, { port: 8080, state: "stopped", timeout: 5 }));

    expect(res.failed ?? false).toBe(false);
    expect(res.msg).toBe("wait_for: 127.0.0.1:8080 closed");
  });

  test("state:absent ignores search_regex and succeeds when the path is gone", async () => {
    const path = "/tmp/rolecall-wait.gone";
    const conn = new ScriptedConnection((cmd) => {
      if (cmd === `test -e '${path}'`) return fail();
      throw new Error(`unexpected command: ${cmd}`);
    });

    const res = await waitForModule.run(
      ctx(conn, { path, search_regex: "never", state: "absent", timeout: 5 }),
    );

    expect(res.failed ?? false).toBe(false);
    expect(res.msg).toBe(`wait_for: ${path} absent`);
    expect(conn.calls).toContain(`test -e '${path}'`);
  });
});

describe("wait_for drained state", () => {
  test("issues the ss command and succeeds when nothing is established", async () => {
    const ss = "ss -Htn state established '( sport = :5432 )'";
    const conn = new ScriptedConnection((cmd) => {
      if (cmd === ss) return ok("");
      throw new Error(`unexpected command: ${cmd}`);
    });

    const res = await waitForModule.run(ctx(conn, { port: 5432, state: "drained", timeout: 5 }));

    expect(res.failed ?? false).toBe(false);
    expect(res.msg).toBe("wait_for: no established connections on port 5432");
    expect(conn.calls).toContain(ss);
  });

  test("falls back to netstat when ss fails and detects established connections", async () => {
    const ss = "ss -Htn state established '( sport = :5432 )'";
    const conn = new ScriptedConnection((cmd) => {
      if (cmd === ss) return fail("ss: not found");
      if (cmd === "netstat -an") {
        return ok("tcp 0 0 127.0.0.1:5432 127.0.0.1:4444 ESTABLISHED\n");
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    const res = await waitForModule.run(ctx(conn, { port: 5432, state: "drained", timeout: 0 }));

    expect(res.changed).toBe(false);
    expect(res.failed).toBe(true);
    expect(String(res.msg)).toContain("established connections");
    expect(conn.calls).toContain("netstat -an");
  });

  test("fails when state:drained is requested without a port", async () => {
    const conn = new ScriptedConnection(() => {
      throw new Error("no command should be issued");
    });

    const res = await waitForModule.run(ctx(conn, { state: "drained" }));

    expect(res.changed).toBe(false);
    expect(res.failed).toBe(true);
    expect(String(res.msg)).toContain("requires `port`");
    expect(conn.calls).toEqual([]);
  });
});

describe("wait_for validation", () => {
  test("fails with an actionable message when no target is set", async () => {
    const conn = new ScriptedConnection(() => {
      throw new Error("no command should be issued");
    });

    const res = await waitForModule.run(ctx(conn, {}));

    expect(res.changed).toBe(false);
    expect(res.failed).toBe(true);
    expect(String(res.msg)).toContain("nothing to wait for");
    expect(conn.calls).toEqual([]);
  });

  test("fails with an actionable message on an invalid state", async () => {
    const conn = new ScriptedConnection(() => {
      throw new Error("no command should be issued");
    });

    const res = await waitForModule.run(ctx(conn, { port: 80, state: "bogus" }));

    expect(res.changed).toBe(false);
    expect(res.failed).toBe(true);
    expect(String(res.msg)).toContain("invalid state");
  });
});
