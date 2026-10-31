import { describe, expect, test } from "bun:test";
import type { Connection, ConnectionFacts, ExecResult, HealthStatus } from "../src/transport/connection";
import type { ModuleContext } from "../src/executor/module";
import { hostnameModule } from "../src/modules/builtins/hostname";
import { ufwModule } from "../src/modules/builtins/ufw";

const ok = (stdout = ""): ExecResult => ({ exitCode: 0, stdout, stderr: "" });
const fail = (stderr = ""): ExecResult => ({ exitCode: 1, stdout: "", stderr });

class MemConn implements Connection {
  readonly kind = "local";
  readonly calls: string[] = [];
  constructor(private readonly handler: (cmd: string) => ExecResult) {}
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async facts(): Promise<ConnectionFacts> {
    return { host: "h1", user: "x", transport: "local" };
  }
  async health(): Promise<HealthStatus> {
    return { ok: true };
  }
  async exec(command: string): Promise<ExecResult> {
    this.calls.push(command);
    return this.handler(command);
  }
}

function ctxWith(conn: Connection, args: Record<string, unknown>, become = false): ModuleContext {
  return { host: "h1", connection: conn, args, vars: {}, facts: {}, reg: {}, become } as unknown as ModuleContext;
}

const hostnameConn = (opts: { systemd?: boolean } = {}): MemConn =>
  new MemConn((cmd) => {
    if (cmd.includes("hostname 2>/dev/null")) return ok("oldhost");
    if (cmd.includes("command -v hostnamectl")) return opts.systemd ? ok("/usr/bin/hostnamectl") : fail();
    return ok();
  });

const ufwConn = (): MemConn => new MemConn(() => ok());

describe("hostname use selection", () => {
  test("use: systemd issues hostnamectl set-hostname", async () => {
    const conn = hostnameConn();
    const res = await hostnameModule.run(ctxWith(conn, { name: "web-01", use: "systemd" }));
    expect(res.failed).toBeFalsy();
    expect(res.changed).toBe(true);
    expect(conn.calls).toContain("hostnamectl set-hostname 'web-01'");
  });

  test("use: network edits /etc/sysconfig/network", async () => {
    const conn = hostnameConn();
    const res = await hostnameModule.run(ctxWith(conn, { name: "web-01", use: "network" }));
    expect(res.failed).toBeFalsy();
    expect(res.changed).toBe(true);
    const setCmd = conn.calls.at(-1) ?? "";
    expect(setCmd).toContain("/etc/sysconfig/network");
    expect(setCmd).toContain("HOSTNAME=$1");
    expect(setCmd).toContain("sed -i");
  });

  test("use: network respects become", async () => {
    const conn = hostnameConn();
    await hostnameModule.run(ctxWith(conn, { name: "web-01", use: "network" }, true));
    expect(conn.calls.at(-1)).toStartWith("sudo sh -c");
  });

  test("use: non-os issues runtime hostname only", async () => {
    const conn = hostnameConn();
    const res = await hostnameModule.run(ctxWith(conn, { name: "web-01", use: "non-os" }));
    expect(res.failed).toBeFalsy();
    expect(res.changed).toBe(true);
    expect(conn.calls.at(-1)).toBe("hostname 'web-01'");
  });

  test("invalid use fails before any remote exec", async () => {
    const conn = hostnameConn();
    const res = await hostnameModule.run(ctxWith(conn, { name: "web-01", use: "bsd" }));
    expect(res.failed).toBe(true);
    expect(res.msg).toContain("invalid 'use'");
    expect(conn.calls.length).toBe(0);
  });
});

describe("hostname auto behavior", () => {
  test("uses hostnamectl when available", async () => {
    const conn = hostnameConn({ systemd: true });
    const res = await hostnameModule.run(ctxWith(conn, { name: "web-01" }));
    expect(res.failed).toBeFalsy();
    expect(conn.calls).toContain("hostnamectl set-hostname 'web-01'");
  });

  test("falls back to hostname + /etc/hostname when hostnamectl absent", async () => {
    const conn = hostnameConn({ systemd: false });
    const res = await hostnameModule.run(ctxWith(conn, { name: "web-01" }));
    expect(res.failed).toBeFalsy();
    expect(res.changed).toBe(true);
    const setCmd = conn.calls.at(-1) ?? "";
    expect(setCmd).toContain("hostname 'web-01'");
    expect(setCmd).toContain("/etc/hostname");
  });
});

describe("ufw default policy", () => {
  test("default: deny issues 'ufw default deny incoming'", async () => {
    const conn = ufwConn();
    const res = await ufwModule.run(ctxWith(conn, { default: "deny" }));
    expect(res.failed).toBeFalsy();
    expect(res.changed).toBe(true);
    expect(conn.calls).toEqual(["ufw default deny incoming"]);
  });

  test("default policy respects become", async () => {
    const conn = ufwConn();
    await ufwModule.run(ctxWith(conn, { default: "allow" }, true));
    expect(conn.calls[0]).toStartWith("sudo sh -c");
  });

  test("invalid default fails before any exec", async () => {
    const conn = ufwConn();
    const res = await ufwModule.run(ctxWith(conn, { default: "drop" }));
    expect(res.failed).toBe(true);
    expect(res.msg).toContain("invalid 'default'");
    expect(conn.calls.length).toBe(0);
  });
});

describe("ufw rule spec", () => {
  test("builds from_ip + interface + log spec", async () => {
    const conn = ufwConn();
    const res = await ufwModule.run(
      ctxWith(conn, { rule: "allow", from_ip: "10.0.0.0/8", interface: "eth0", log: true }),
    );
    expect(res.failed).toBeFalsy();
    expect(res.changed).toBe(true);
    expect(conn.calls).toEqual(["ufw allow on eth0 from 10.0.0.0/8 log"]);
    expect(res.data).toEqual({ rule: "allow", port: "", proto: "" });
  });
});
