import { describe, expect, test } from "bun:test";
import type { Connection, ConnectionFacts, ExecResult, HealthStatus } from "../src/transport/connection";
import type { ModuleContext } from "../src/executor/module";
import { mountModule } from "../src/modules/builtins/mount";
import { sysctlModule } from "../src/modules/builtins/sysctl";

const ok = (stdout = ""): ExecResult => ({ exitCode: 0, stdout, stderr: "" });
const fail = (stderr = ""): ExecResult => ({ exitCode: 1, stdout: "", stderr });

class MemConn implements Connection {
  readonly kind = "local";
  readonly calls: string[] = [];
  constructor(private readonly handler: (cmd: string, calls: string[]) => ExecResult) {}
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
    return this.handler(command, this.calls);
  }
}

function ctxWith(conn: Connection, args: Record<string, unknown>): ModuleContext {
  return { host: "h1", connection: conn, args, vars: {}, facts: {}, reg: {}, become: false } as unknown as ModuleContext;
}

const mountConn = (mounted = false): MemConn =>
  new MemConn((cmd) => {
    if (cmd.includes("findmnt")) return mounted ? ok("/mnt/data") : fail();
    if (cmd.includes("/etc/fstab")) return ok();
    if (cmd.includes("mount -t")) return ok();
    return ok();
  });

const sysctlConn = (opts: { current?: string; sysctlExit?: number } = {}): MemConn =>
  new MemConn((cmd) => {
    if (cmd.startsWith("cat ")) return ok(opts.current ?? "0");
    if (cmd.includes("sysctl -w")) return (opts.sysctlExit ?? 0) === 0 ? ok() : fail("cannot set");
    if (cmd.includes("sysctl --system")) return ok();
    if (cmd.includes("99-rolecall.conf")) return ok();
    return ok();
  });

const fstabAppend = (conn: MemConn): string | undefined => conn.calls.find((c) => c.includes("/etc/fstab"));

describe("mount fstab dump/passno", () => {
  test("fstab line uses supplied dump and passno", async () => {
    const conn = mountConn();
    const res = await mountModule.run(
      ctxWith(conn, { path: "/mnt/data", src: "/dev/sdb1", fstype: "ext4", dump: 1, passno: 2 }),
    );
    expect(res.failed).toBeFalsy();
    expect(res.changed).toBe(true);
    expect(fstabAppend(conn)).toContain('ext4 defaults 1 2');
  });

  test("fstab line defaults dump/passno to 0 0", async () => {
    const conn = mountConn();
    const res = await mountModule.run(
      ctxWith(conn, { path: "/mnt/data", src: "/dev/sdb1", fstype: "ext4" }),
    );
    expect(res.failed).toBeFalsy();
    expect(fstabAppend(conn)).toContain('ext4 defaults 0 0');
  });

  test("fstab accepts string dump/passno", async () => {
    const conn = mountConn();
    await mountModule.run(
      ctxWith(conn, { path: "/mnt/data", src: "/dev/sdb1", fstype: "ext4", dump: "0", passno: "1" }),
    );
    expect(fstabAppend(conn)).toContain('ext4 defaults 0 1');
  });

  test("boot: false skips all /etc/fstab writes", async () => {
    const conn = mountConn();
    const res = await mountModule.run(
      ctxWith(conn, { path: "/mnt/data", src: "/dev/sdb1", fstype: "ext4", boot: false }),
    );
    expect(res.failed).toBeFalsy();
    expect(res.changed).toBe(true);
    expect(conn.calls.some((c) => c.includes("mount -t"))).toBe(true);
    expect(conn.calls.every((c) => !c.includes("/etc/fstab"))).toBe(true);
  });
});

describe("sysctl reload/sysctl_set/ignoreerrors", () => {
  test("reload: false produces no sysctl --system", async () => {
    const conn = sysctlConn({ current: "0" });
    const res = await sysctlModule.run(ctxWith(conn, { name: "net.ipv4.ip_forward", value: "1", reload: false }));
    expect(res.failed).toBeFalsy();
    expect(res.changed).toBe(true);
    expect(conn.calls.some((c) => c.includes("sysctl --system"))).toBe(false);
  });

  test("reload defaults to true and runs sysctl --system", async () => {
    const conn = sysctlConn({ current: "0" });
    const res = await sysctlModule.run(ctxWith(conn, { name: "net.ipv4.ip_forward", value: "1" }));
    expect(res.failed).toBeFalsy();
    expect(conn.calls.some((c) => c.includes("sysctl --system"))).toBe(true);
  });

  test("sysctl_set: false produces no persistence file write", async () => {
    const conn = sysctlConn({ current: "0" });
    const res = await sysctlModule.run(ctxWith(conn, { name: "net.ipv4.ip_forward", value: "1", sysctl_set: false }));
    expect(res.failed).toBeFalsy();
    expect(res.changed).toBe(true);
    expect(conn.calls.some((c) => c.includes("99-rolecall.conf"))).toBe(false);
  });

  test("ignoreerrors: true returns changed (not failed) on a non-zero sysctl -w", async () => {
    const conn = sysctlConn({ current: "0", sysctlExit: 1 });
    const res = await sysctlModule.run(
      ctxWith(conn, { name: "net.ipv4.ip_forward", value: "1", ignoreerrors: true }),
    );
    expect(res.failed).toBeFalsy();
    expect(res.changed).toBe(true);
  });

  test("without ignoreerrors a non-zero sysctl -w fails", async () => {
    const conn = sysctlConn({ current: "0", sysctlExit: 1 });
    const res = await sysctlModule.run(ctxWith(conn, { name: "net.ipv4.ip_forward", value: "1" }));
    expect(res.failed).toBe(true);
  });
});
