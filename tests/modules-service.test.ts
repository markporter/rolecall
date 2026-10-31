// Hermetic tests for the `service` module Ansible-parity work: `scope`
// (system/user), `pattern` (pgrep liveness fallback), `runlevel` (SysV
// chkconfig), and `sleep` (a client-side delay, not a remote command). All OS
// work is routed through an in-memory scripted Connection (no network, no root,
// no real systemd). Bun-only MVP (bun test).

import { describe, expect, test } from "bun:test";
import type { Connection, ExecResult } from "../src/transport/connection";
import type { ModuleContext } from "../src/executor/module";
import { serviceModule } from "../src/modules/builtins/service";

const ok = (stdout = ""): ExecResult => ({ exitCode: 0, stdout, stderr: "" });
const fail = (stderr = ""): ExecResult => ({ exitCode: 1, stdout: "", stderr: "" });

function ctxWith(conn: Connection, args: Record<string, unknown>, become = false): ModuleContext {
  return { host: "h1", connection: conn, args, vars: {}, facts: {}, registered: {}, become } as unknown as ModuleContext;
}

class ServiceMem implements Connection {
  readonly kind = "local";
  readonly calls: string[] = [];
  private readonly systemd: boolean;
  private readonly active: boolean;
  private readonly enabled: boolean;
  private readonly pattern: boolean;
  private readonly onRunlevels: string[];

  constructor(
    opts: {
      systemd?: boolean;
      active?: boolean;
      enabled?: boolean;
      pattern?: boolean;
      onRunlevels?: string[];
    } = {},
  ) {
    this.systemd = opts.systemd !== false;
    this.active = opts.active !== false;
    this.enabled = opts.enabled !== false;
    this.pattern = opts.pattern === true;
    this.onRunlevels = opts.onRunlevels ?? [];
  }

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
    const cmd = command.replace(/^sudo /, "");
    if (cmd === "command -v systemctl") return this.systemd ? ok("/usr/bin/systemctl") : fail();

    if (/^systemctl (?:--user )?is-active \S+$/.test(cmd)) return this.active ? ok("active") : fail();
    if (/^systemctl (?:--user )?is-enabled \S+$/.test(cmd)) return this.enabled ? ok("enabled") : fail();
    if (/^pgrep -f /.test(cmd)) return this.pattern ? ok("4242") : fail();

    const chkList = /^chkconfig --list (\S+)(?: 2>\/dev\/null)?$/.exec(cmd);
    if (chkList) {
      const unit = chkList[1];
      const tokens = ["0", "1", "2", "3", "4", "5", "6"].map(
        (level) => `${unit}:${level}:${this.onRunlevels.includes(level) ? "on" : "off"}`,
      );
      return ok(tokens.join(" "));
    }

    if (/^chkconfig (?:--level \S+ )?\S+ (?:on|off)$/.test(cmd)) return ok();
    if (/^systemctl (?:--user )?(?:start|stop|restart|reload|enable|disable|daemon-reload) /.test(cmd)) return ok();
    if (/^service \S+ (?:start|stop|restart|reload|status)$/.test(cmd)) return ok();
    throw new Error(`ServiceMem: unexpected command: ${cmd}`);
  }
}

describe("service module scope", () => {
  test("scope: user emits systemctl --user and never prefixes sudo", async () => {
    const conn = new ServiceMem();
    const res = await serviceModule.run(ctxWith(conn, { name: "nginx", scope: "user", state: "started" }, true));
    expect(res.failed).toBeFalsy();
    expect(conn.calls.some((c) => c.includes("systemctl --user is-active nginx"))).toBe(true);
    expect(conn.calls.every((c) => !c.startsWith("sudo"))).toBe(true);
  });

  test("scope: user starts through systemctl --user with no sudo", async () => {
    const conn = new ServiceMem({ active: false });
    const res = await serviceModule.run(ctxWith(conn, { name: "nginx", scope: "user", state: "started" }, true));
    expect(res.failed).toBeFalsy();
    expect(conn.calls).toContain("systemctl --user start nginx");
    expect(conn.calls.every((c) => !c.startsWith("sudo"))).toBe(true);
  });

  test("an invalid scope fails fast before any remote exec", async () => {
    const conn = new ServiceMem();
    const res = await serviceModule.run(ctxWith(conn, { name: "nginx", scope: "container" }));
    expect(res.failed).toBe(true);
    expect(String(res.msg)).toContain("scope");
    expect(conn.calls.length).toBe(0);
  });

  test("scope: user without systemd fails with an actionable error", async () => {
    const conn = new ServiceMem({ systemd: false });
    const res = await serviceModule.run(ctxWith(conn, { name: "nginx", scope: "user" }));
    expect(res.failed).toBe(true);
    expect(String(res.msg)).toContain("systemd");
  });
});

describe("service module pattern fallback", () => {
  test("state: started is a no-op when the primary probe is inactive but pattern matches", async () => {
    const conn = new ServiceMem({ active: false, pattern: true });
    const res = await serviceModule.run(ctxWith(conn, { name: "nginx", pattern: "nginx: worker", state: "started" }));
    expect(res.failed).toBeFalsy();
    expect(res.changed).toBe(false);
    expect(conn.calls.some((c) => c.includes("pgrep -f 'nginx: worker'"))).toBe(true);
    expect(conn.calls.some((c) => /systemctl start /.test(c))).toBe(false);
  });

  test("state: stopped stops the service when pattern says it is running", async () => {
    const conn = new ServiceMem({ active: false, pattern: true });
    const res = await serviceModule.run(ctxWith(conn, { name: "nginx", pattern: "nginx", state: "stopped" }));
    expect(res.failed).toBeFalsy();
    expect(res.changed).toBe(true);
    expect(conn.calls).toContain("systemctl stop nginx");
  });

  test("state: started still starts when the primary probe and pattern both report inactive", async () => {
    const conn = new ServiceMem({ active: false, pattern: false });
    const res = await serviceModule.run(ctxWith(conn, { name: "nginx", pattern: "nginx", state: "started" }));
    expect(res.failed).toBeFalsy();
    expect(res.changed).toBe(true);
    expect(conn.calls).toContain("systemctl start nginx");
  });
});

describe("service module runlevel (SysV)", () => {
  test("enabling uses chkconfig --level <runlevel> <name> on", async () => {
    const conn = new ServiceMem({ systemd: false, onRunlevels: [] });
    const res = await serviceModule.run(ctxWith(conn, { name: "nginx", runlevel: "3", enabled: true }));
    expect(res.failed).toBeFalsy();
    expect(conn.calls).toContain("chkconfig --level 3 nginx on");
  });

  test("disabling uses chkconfig --level <runlevel> <name> off", async () => {
    const conn = new ServiceMem({ systemd: false, onRunlevels: ["3"] });
    const res = await serviceModule.run(ctxWith(conn, { name: "nginx", runlevel: "3", enabled: false }));
    expect(res.failed).toBeFalsy();
    expect(conn.calls).toContain("chkconfig --level 3 nginx off");
  });

  test("an already-enabled runlevel is left untouched", async () => {
    const conn = new ServiceMem({ systemd: false, onRunlevels: ["3"] });
    const res = await serviceModule.run(ctxWith(conn, { name: "nginx", runlevel: "3", enabled: true }));
    expect(res.failed).toBeFalsy();
    expect(res.changed).toBe(false);
    expect(conn.calls.some((c) => /^chkconfig --level 3 nginx on$/.test(c))).toBe(false);
  });

  test("runlevel on a systemd target fails with an actionable error", async () => {
    const conn = new ServiceMem();
    const res = await serviceModule.run(ctxWith(conn, { name: "nginx", runlevel: "3" }));
    expect(res.failed).toBe(true);
    expect(String(res.msg)).toContain("runlevel");
  });
});

describe("service module sleep", () => {
  test("sleep: 0 behaves like a normal run and logs no delay", async () => {
    const conn = new ServiceMem();
    const res = await serviceModule.run(ctxWith(conn, { name: "nginx", sleep: 0 }));
    expect(res.failed).toBeFalsy();
    expect(res.changed).toBe(false);
    expect(res.stdout ?? "").not.toContain("slept");
    expect(conn.calls.length).toBeGreaterThan(0);
  });

  test("a positive sleep appends a client-side delay and runs no remote command for it", async () => {
    const conn = new ServiceMem();
    const res = await serviceModule.run(ctxWith(conn, { name: "nginx", sleep: 0.01 }));
    expect(res.failed).toBeFalsy();
    expect(res.stdout ?? "").toContain("slept 0.01s");
    expect(conn.calls.every((c) => !c.includes("sleep"))).toBe(true);
  });
});
