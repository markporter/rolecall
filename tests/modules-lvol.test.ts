import { describe, expect, test } from "bun:test";
import type { Connection, ConnectionFacts, ExecResult, HealthStatus } from "../src/transport/connection";
import type { ModuleContext } from "../src/executor/module";
import { buildLvolPlan, lvolModule } from "../src/modules/builtins/lvol";

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

const lvolConn = (opts: { exists?: boolean; current?: string } = {}): MemConn =>
  new MemConn((cmd) => {
    if (cmd.includes("lv_size")) return opts.exists === false ? fail() : ok(opts.current ?? "10737418240");
    if (cmd.includes("lvs")) return opts.exists ? ok() : fail();
    return ok();
  });

const mutating = (conn: MemConn): string[] =>
  conn.calls.filter((c) => /\blv(create|extend|reduce|remove)\b/.test(c));

const TEN_G = "10737418240";

describe("lvol thin provisioning", () => {
  test("thin create uses lvcreate -V with -T <vg>/<pool>", async () => {
    const conn = lvolConn({ exists: false });
    const res = await lvolModule.run(
      ctxWith(conn, { vg: "vg0", lv: "data", size: "10G", thin: true, thinpool: "pool0" }),
    );
    expect(res.failed).toBeFalsy();
    expect(res.changed).toBe(true);
    const first = mutating(conn)[0];
    expect(first).toContain("lvcreate -V 10G");
    expect(first).toContain("-T 'vg0/pool0'");
    expect(first).toContain("-n 'data'");
    expect(first).not.toContain(" -L ");
  });

  test("thin create without thinpool fails and issues no lvcreate", async () => {
    const conn = lvolConn({ exists: false });
    const res = await lvolModule.run(ctxWith(conn, { vg: "vg0", lv: "data", size: "10G", thin: true }));
    expect(res.failed).toBe(true);
    expect(res.msg).toContain("thinpool");
    expect(mutating(conn)).toEqual([]);
  });
});

describe("lvol resize", () => {
  test("grow uses lvextend -L", async () => {
    const conn = lvolConn({ exists: true, current: TEN_G });
    const res = await lvolModule.run(ctxWith(conn, { vg: "vg0", lv: "data", size: "20G" }));
    expect(res.failed).toBeFalsy();
    expect(res.changed).toBe(true);
    const extend = mutating(conn).find((c) => c.includes("lvextend"));
    expect(extend).toContain("lvextend -L 20G");
    expect(extend).not.toContain(" -r");
  });

  test("resizefs: true adds -r to lvextend", async () => {
    const conn = lvolConn({ exists: true, current: TEN_G });
    const res = await lvolModule.run(
      ctxWith(conn, { vg: "vg0", lv: "data", size: "20G", resizefs: true }),
    );
    expect(res.failed).toBeFalsy();
    const extend = mutating(conn).find((c) => c.includes("lvextend"));
    expect(extend).toContain("-r");
  });

  test("shrink without shrink: true fails actionably and issues no lvreduce", async () => {
    const conn = lvolConn({ exists: true, current: TEN_G });
    const res = await lvolModule.run(ctxWith(conn, { vg: "vg0", lv: "data", size: "5G" }));
    expect(res.failed).toBe(true);
    expect(res.msg).toContain("shrink: true");
    expect(mutating(conn)).toEqual([]);
  });

  test("shrink with shrink: true uses lvreduce -L with -f", async () => {
    const conn = lvolConn({ exists: true, current: TEN_G });
    const res = await lvolModule.run(
      ctxWith(conn, { vg: "vg0", lv: "data", size: "5G", shrink: true }),
    );
    expect(res.failed).toBeFalsy();
    expect(res.changed).toBe(true);
    const reduce = mutating(conn).find((c) => c.includes("lvreduce"));
    expect(reduce).toContain("lvreduce -L 5G");
    expect(reduce).toContain("-f");
  });

  test("equal size is a no-op", async () => {
    const conn = lvolConn({ exists: true, current: TEN_G });
    const res = await lvolModule.run(ctxWith(conn, { vg: "vg0", lv: "data", size: "10G" }));
    expect(res.failed).toBeFalsy();
    expect(res.changed).toBe(false);
    expect(res.skipped).toBe(true);
    expect(mutating(conn)).toEqual([]);
  });

  test("percentage sizes skip the diff and defer to lvextend", async () => {
    const conn = lvolConn({ exists: true, current: TEN_G });
    const res = await lvolModule.run(
      ctxWith(conn, { vg: "vg0", lv: "data", size: "100%FREE" }),
    );
    expect(res.failed).toBeFalsy();
    const extend = mutating(conn).find((c) => c.includes("lvextend"));
    expect(extend).toContain("lvextend -L 100%FREE");
  });
});

describe("lvol absent", () => {
  test("absent removes with lvremove -f", async () => {
    const conn = lvolConn({ exists: true, current: TEN_G });
    const res = await lvolModule.run(ctxWith(conn, { vg: "vg0", lv: "data", state: "absent" }));
    expect(res.failed).toBeFalsy();
    expect(res.changed).toBe(true);
    const remove = mutating(conn).find((c) => c.includes("lvremove"));
    expect(remove).toContain("lvremove -f 'vg0/data'");
  });

  test("absent on a missing LV is skipped without lvremove", async () => {
    const conn = lvolConn({ exists: false });
    const res = await lvolModule.run(ctxWith(conn, { vg: "vg0", lv: "data", state: "absent" }));
    expect(res.changed).toBe(false);
    expect(res.skipped).toBe(true);
    expect(mutating(conn)).toEqual([]);
  });
});

describe("buildLvolPlan", () => {
  test("is pure and reports absent no-op", () => {
    const plan = buildLvolPlan({ vg: "vg0", lv: "data", state: "absent" });
    expect(plan.noop).toBe(true);
    expect(plan.action).toBe("none");
  });

  test("refuses shrink without shrink: true", () => {
    const plan = buildLvolPlan(
      { vg: "vg0", lv: "data", size: "5G" },
      10 * 1024 ** 3,
    );
    expect(plan.error).toContain("shrink: true");
    expect(plan.command).toBe("");
  });
});
