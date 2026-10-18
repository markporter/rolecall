// Hermetic tests for the `package` built-in (P7).
//
// Uses a SCRIPTED fake Connection that implements the FULL Connection interface
// (all six members) and answers `exec` by evaluating ordered substring rules, so
// nothing touches the network or a real package manager. The context is bridged
// via `as unknown as ModuleContext` (never `as any`).

import { describe, expect, test } from "bun:test";
import type { Connection, ExecResult } from "../src/transport/connection";
import type { ModuleContext } from "../src/executor/module";
import { pkgModule } from "../src/modules/builtins/package";

/** A single scripted response keyed by an arbitrary predicate over the command. */
interface Rule {
  when: (command: string) => boolean;
  result: ExecResult;
}

const ok: ExecResult = { exitCode: 0, stdout: "", stderr: "" };
const miss: ExecResult = { exitCode: 1, stdout: "", stderr: "not found" };

/**
 * ScriptedConnection satisfies every member of the Connection contract: read-only
 * kind, connect/disconnect/facts/health no-ops returning sane values, and an exec
 * that walks `rules` in order returning the first match (defaulting to `ok`).
 */
class ScriptedConn implements Connection {
  readonly kind = "local";
  public readonly calls: string[] = [];
  private readonly rules: Rule[];

  constructor(rules: Rule[]) {
    this.rules = rules;
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}

  async exec(command: string): Promise<ExecResult> {
    this.calls.push(command);
    for (const r of this.rules) {
      if (r.when(command)) return r.result;
    }
    return ok;
  }

  async facts(): Promise<{ host: string; user: string; transport: "local" }> {
    return { host: "h1", user: "x", transport: "local" };
  }

  async health(): Promise<{ ok: boolean }> {
    return { ok: true };
  }
}

function makeCtx(conn: Connection, args: Record<string, unknown>, become = false): ModuleContext {
  return {
    host: "h1",
    connection: conn,
    args,
    vars: {},
    facts: {},
    registered: {},
    become,
  } as unknown as ModuleContext;
}

async function run(args: Record<string, unknown>, conn: Connection, become = false) {
  return pkgModule.run(makeCtx(conn, args, become));
}

describe("package module", () => {
  test("present + already installed -> changed:false, no install issued", async () => {
    const conn = new ScriptedConn([
      { when: (c) => /which apt-get/.test(c), result: ok },
      { when: (c) => c.includes("dpkg -s"), result: ok },
    ]);
    const res = await run({ name: "nginx", state: "present" }, conn);
    expect(res.changed).toBe(false);
    expect(res.data?.manager).toBe("apt");
    expect(res.stdout).toContain("already present");
    expect(conn.calls.some((c) => c.includes("install"))).toBe(false);
  });

  test("present + missing -> changed:true and native install command issued", async () => {
    const conn = new ScriptedConn([
      { when: (c) => /which apt-get/.test(c), result: ok },
      { when: (c) => c.includes("dpkg -s"), result: miss },
      { when: (c) => c.includes("apt-get install"), result: ok },
    ]);
    const res = await run({ name: "nginx", state: "present" }, conn);
    expect(res.changed).toBe(true);
    expect(res.data?.manager).toBe("apt");
    expect(
      conn.calls.some((c) => c.trim().endsWith("apt-get install -y nginx")),
    ).toBe(true);
  });

  test("present + version pin uses apt <name>=<version> syntax", async () => {
    const conn = new ScriptedConn([
      { when: (c) => /which apt-get/.test(c), result: ok },
      { when: (c) => c.includes("dpkg -s"), result: miss },
      { when: (c) => c.includes("apt-get update"), result: ok },
      { when: (c) => c.includes("apt-get install"), result: ok },
    ]);
    const res = await run({ name: "nginx", state: "present", version: "1.26.0-1" }, conn);
    expect(res.changed).toBe(true);
    expect(res.msg).toContain("(1.26.0-1)");
    // No update_cache requested -> no apt-get update call.
    expect(conn.calls.some((c) => c.includes("apt-get update"))).toBe(false);
    expect(
      conn.calls.some((c) => c.endsWith("apt-get install -y nginx=1.26.0-1")),
    ).toBe(true);
  });

  test("update_cache runs apt-get update before installing", async () => {
    const conn = new ScriptedConn([
      { when: (c) => /which apt-get/.test(c), result: ok },
      { when: (c) => c.includes("dpkg -s"), result: miss },
      { when: (c) => c.includes("apt-get update"), result: ok },
      { when: (c) => c.includes("apt-get install"), result: ok },
    ]);
    const res = await run({ name: "nginx", state: "present", update_cache: true }, conn);
    expect(res.changed).toBe(true);
    const idxUpdate = conn.calls.findIndex((c) => c.includes("apt-get update"));
    const idxInstall = conn.calls.findIndex((c) => c.includes("apt-get install"));
    expect(idxUpdate).toBeGreaterThanOrEqual(0);
    expect(idxInstall).toBeGreaterThan(idxUpdate);
  });

  test("absent + installed -> changed:true and remove command issued", async () => {
    const conn = new ScriptedConn([
      { when: (c) => /which apt-get/.test(c), result: ok },
      { when: (c) => c.includes("dpkg -s"), result: ok },
      { when: (c) => c.includes("apt-get remove"), result: ok },
    ]);
    const res = await run({ name: "nginx", state: "absent" }, conn);
    expect(res.changed).toBe(true);
    expect(conn.calls.some((c) => c.trim().endsWith("apt-get remove -y nginx"))).toBe(true);
  });

  test("absent + not installed -> changed:false", async () => {
    const conn = new ScriptedConn([
      { when: (c) => /which apt-get/.test(c), result: ok },
      { when: (c) => c.includes("dpkg -s"), result: miss },
    ]);
    const res = await run({ name: "nginx", state: "absent" }, conn);
    expect(res.changed).toBe(false);
    expect(res.failed).toBeUndefined();
    expect(conn.calls.some((c) => c.includes("remove"))).toBe(false);
  });

  test("detects dnf when apt probes fail first", async () => {
    const conn = new ScriptedConn([
      { when: (c) => c.includes("which apt-get"), result: miss },
      { when: (c) => c.includes("which dnf"), result: ok },
      { when: (c) => c.includes("rpm -q"), result: miss },
      { when: (c) => c.includes("dnf install"), result: ok },
    ]);
    const res = await run({ name: "httpd", state: "present" }, conn);
    expect(res.data?.manager).toBe("dnf");
    expect(res.changed).toBe(true);
    expect(
      conn.calls.some((c) => c.trim().endsWith("dnf install -y httpd")),
    ).toBe(true);
    // The failing apt probe must have been attempted before dnf.
    expect(conn.calls[0]).toContain("which apt-get");
  });

  test("detects apk for Alpine-style targets", async () => {
    const conn = new ScriptedConn([
      { when: (c) => c.includes("which apt-get"), result: miss },
      { when: (c) => c.includes("which dnf"), result: miss },
      { when: (c) => c.includes("which yum"), result: miss },
      { when: (c) => c.includes("which apk"), result: ok },
      { when: (c) => c.includes("apk info -e"), result: miss },
      { when: (c) => c.includes("apk add"), result: ok },
    ]);
    const res = await run({ name: "curl", state: "present" }, conn);
    expect(res.data?.manager).toBe("apk");
    expect(conn.calls.some((c) => c.trim().endsWith("apk add curl"))).toBe(true);
  });

  test("fails cleanly when no package manager exists", async () => {
    const conn = new ScriptedConn([{ when: () => true, result: miss }]);
    const res = await run({ name: "nginx", state: "present" }, conn);
    expect(res.failed).toBe(true);
    expect(res.changed).toBe(false);
    expect(res.msg).toBe("no supported package manager found on target");
  });

  test("applies sudo prefix when become is requested", async () => {
    const conn = new ScriptedConn([
      { when: (c) => /sudo which apt-get/.test(c), result: ok },
      { when: (c) => c.includes("dpkg -s"), result: miss },
      { when: (c) => c.includes("apt-get install"), result: ok },
    ]);
    const res = await run({ name: "nginx", state: "present" }, conn, /* become */ true);
    expect(res.changed).toBe(true);
    expect(conn.calls.every((c) => c.startsWith("sudo "))).toBe(true);
    expect(conn.calls.some((c) => c.endsWith("sudo apt-get install -y nginx"))).toBe(true);
  });

  test("missing 'name' fails validation", async () => {
    const conn = new ScriptedConn([{ when: () => true, result: ok }]);
    const res = await run({}, conn);
    expect(res.failed).toBe(true);
    expect(res.msg).toContain("'name' is required");
    expect(conn.calls.length).toBe(0);
  });
});
