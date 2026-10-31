// Hermetic tests for the Ansible-parity additions to the `cron` builtin:
// `backup`, `env`, `insertafter`/`insertbefore`, and `mode`. Every OS call is
// routed through an in-memory scripted Connection (no network, no root, no real
// crontab/root filesystem), so the exact remote command strategy and
// idempotency behaviour are asserted deterministically. Bun-only MVP (bun test).

import { describe, expect, test } from "bun:test";
import type { Connection, ExecResult } from "../src/transport/connection";
import type { ModuleContext } from "../src/executor/module";
import { cronModule } from "../src/modules/builtins/cron";

const ok = (stdout = ""): ExecResult => ({ exitCode: 0, stdout, stderr: "" });
const fail = (stderr = "not found"): ExecResult => ({ exitCode: 1, stdout: "", stderr });

function ctxWith(conn: Connection, args: Record<string, unknown>, become = false): ModuleContext {
  return { host: "h1", connection: conn, args, vars: {}, facts: {}, registered: {}, become } as unknown as ModuleContext;
}

/** In-memory crontab + POSIX filesystem: crontab reads/writes, file reads/writes, chmod. */
class CronMem implements Connection {
  readonly kind = "local";
  readonly calls: string[] = [];
  readonly files = new Map<string, string>();
  tab: string;

  constructor(initial = "") {
    this.tab = initial;
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
    const tabRead = cmd.match(/^crontab -l -u '([^']*)' 2>\/dev\/null$/);
    if (tabRead) return this.tab ? ok(this.tab) : fail("no crontab for user");
    const tabEmpty = cmd.match(/^crontab -u '[^']*' - <<'([^']+)'\n\1$/);
    if (tabEmpty) {
      this.tab = "";
      return ok();
    }
    const tabWrite = cmd.match(/^crontab -u '[^']*' - <<'([^']+)'\n([\s\S]*)\n\1$/);
    if (tabWrite) {
      this.tab = tabWrite[2]! + "\n";
      return ok();
    }
    const cat = cmd.match(/^cat '([^']*)' 2>\/dev\/null$/);
    if (cat) {
      const content = this.files.get(cat[1]!);
      return content === undefined ? fail("No such file or directory") : ok(content);
    }
    const write = cmd.match(/^cat > '([^']*)' <<'([^']+)'\n([\s\S]*)\n\2$/);
    if (write) {
      this.files.set(write[1]!, write[3]! + "\n");
      return ok();
    }
    if (/^chmod [^ ]+ '[^']*'$/.test(cmd)) return ok();
    throw new Error(`CronMem: unexpected command: ${cmd}`);
  }
}

describe("cron module — env mode", () => {
  test("writes name=job and is idempotent on re-run", async () => {
    const conn = new CronMem();
    const args = { name: "PATH", job: "/usr/local/bin:/usr/bin", env: true, user: "root" };
    const first = await cronModule.run(ctxWith(conn, args));
    expect(first.changed).toBe(true);
    expect(conn.tab).toBe("#Ansible: PATH\nPATH=/usr/local/bin:/usr/bin\n");

    const second = await cronModule.run(ctxWith(conn, args));
    expect(second.changed).toBe(false);
    expect(second.data?.idempotent).toBe(true);
  });

  test("ignores schedule fields and special_time", async () => {
    const conn = new CronMem();
    const res = await cronModule.run(
      ctxWith(conn, { name: "MAILTO", job: "ops@example.com", env: true, special_time: "fortnightly", minute: "5", hour: "6" }),
    );
    expect(res.changed).toBe(true);
    expect(conn.tab).toBe("#Ansible: MAILTO\nMAILTO=ops@example.com\n");
  });

  test("rejects cron_file, disabled, absent and missing job", async () => {
    const conn = new CronMem();
    const withFile = await cronModule.run(ctxWith(conn, { name: "x", job: "v", env: true, cron_file: "rc" }));
    expect(withFile.failed).toBe(true);
    expect(String(withFile.msg)).toContain("'env' is not supported with 'cron_file'");

    const disabled = await cronModule.run(ctxWith(conn, { name: "x", job: "v", env: true, disabled: true }));
    expect(disabled.failed).toBe(true);
    expect(String(disabled.msg)).toContain("'env' cannot be combined with 'disabled'");

    const absent = await cronModule.run(ctxWith(conn, { name: "x", job: "v", env: true, state: "absent" }));
    expect(absent.failed).toBe(true);
    expect(String(absent.msg)).toContain("'env' requires state=present");

    const noJob = await cronModule.run(ctxWith(conn, { name: "x", env: true }));
    expect(noJob.failed).toBe(true);
    expect(String(noJob.msg)).toContain("'job' (the variable value) is required");
  });

  test("check() reports inDesired against the live crontab", async () => {
    const conn = new CronMem("#Ansible: PATH\nPATH=/usr/bin\n");
    const hit = await cronModule.check!({ name: "PATH", job: "/usr/bin", env: true }, ctxWith(conn, {}));
    expect(hit.inDesired).toBe(true);
    const miss = await cronModule.check!({ name: "PATH", job: "/opt/bin", env: true }, ctxWith(conn, {}));
    expect(miss.inDesired).toBe(false);
  });
});

describe("cron module — backup", () => {
  test("writes a timestamped copy and returns data.backup_file", async () => {
    const conn = new CronMem("MAILTO=ops\n");
    const res = await cronModule.run(ctxWith(conn, { name: "nightly", job: "/bin/nightly", user: "root", backup: true }));
    expect(res.changed).toBe(true);
    const backupFile = res.data?.backup_file as string;
    expect(backupFile.startsWith("/tmp/rolecall-crontab-root-")).toBe(true);
    expect(backupFile.endsWith(".bak")).toBe(true);
    expect(conn.files.get(backupFile)).toBe("MAILTO=ops\n");
  });

  test("is skipped on a no-op and in check mode", async () => {
    const conn = new CronMem("MAILTO=ops\n");
    const args = { name: "nightly", job: "/bin/nightly", user: "root", backup: true };
    await cronModule.run(ctxWith(conn, args));
    const after = conn.files.size;
    const second = await cronModule.run(ctxWith(conn, args));
    expect(second.changed).toBe(false);
    expect(conn.files.size).toBe(after);

    const dry = new CronMem("MAILTO=ops\n");
    const res = await cronModule.run(ctxWith(dry, { ...args, _check: true }));
    expect(res.data?.wouldChange).toBe(true);
    expect(dry.files.size).toBe(0);
  });

  test("does not fire when the crontab is empty", async () => {
    const conn = new CronMem();
    const res = await cronModule.run(ctxWith(conn, { name: "nightly", job: "/bin/nightly", backup: true }));
    expect(res.changed).toBe(true);
    expect(res.data?.backup_file).toBeUndefined();
    expect(conn.files.size).toBe(0);
  });

  test("cron_file backup lands beside the managed file", async () => {
    const conn = new CronMem();
    conn.files.set("/etc/cron.d/rolecall-x", "0 1 * * * root /keep\n");
    const res = await cronModule.run(
      ctxWith(conn, { name: "join", job: "/bin/join", cron_file: "rolecall-x", user: "root", backup: true }),
    );
    expect(res.changed).toBe(true);
    const backupFile = res.data?.backup_file as string;
    expect(backupFile.startsWith("/etc/cron.d/rolecall-x.")).toBe(true);
    expect(backupFile.endsWith(".bak")).toBe(true);
    expect(conn.files.get(backupFile)).toBe("0 1 * * * root /keep\n");
    expect(conn.files.get("/etc/cron.d/rolecall-x")).toContain("#Ansible: join");
  });
});

describe("cron module — insertion anchors", () => {
  const base = "0 1 * * * /a\n0 2 * * * /b\n";

  test("insertbefore/insertafter place a new marker+entry pair", async () => {
    const before = new CronMem(base);
    await cronModule.run(ctxWith(before, { name: "n", job: "/n", user: "root", insertbefore: "/b" }));
    expect(before.tab).toBe("0 1 * * * /a\n#Ansible: n\n* * * * * /n\n0 2 * * * /b\n");

    const after = new CronMem(base);
    await cronModule.run(ctxWith(after, { name: "n", job: "/n", user: "root", insertafter: "/a" }));
    expect(after.tab).toBe("0 1 * * * /a\n#Ansible: n\n* * * * * /n\n0 2 * * * /b\n");

    const bof = new CronMem(base);
    await cronModule.run(ctxWith(bof, { name: "n", job: "/n", user: "root", insertbefore: "BOF" }));
    expect(bof.tab).toBe("#Ansible: n\n* * * * * /n\n0 1 * * * /a\n0 2 * * * /b\n");

    const eof = new CronMem(base);
    await cronModule.run(ctxWith(eof, { name: "n", job: "/n", user: "root", insertafter: "EOF" }));
    expect(eof.tab).toBe("0 1 * * * /a\n0 2 * * * /b\n#Ansible: n\n* * * * * /n\n");

    const miss = new CronMem(base);
    await cronModule.run(ctxWith(miss, { name: "n", job: "/n", user: "root", insertbefore: "ZZZ" }));
    expect(miss.tab).toBe("0 1 * * * /a\n0 2 * * * /b\n#Ansible: n\n* * * * * /n\n");
  });

  test("are ignored when the entry already exists (replacement keeps position)", async () => {
    const conn = new CronMem("0 1 * * * /a\n#Ansible: n\n* * * * * /old\n0 2 * * * /b\n");
    await cronModule.run(ctxWith(conn, { name: "n", job: "/new", user: "root", insertbefore: "BOF" }));
    expect(conn.tab).toBe("0 1 * * * /a\n#Ansible: n\n* * * * * /new\n0 2 * * * /b\n");
  });

  test("rejects setting both anchors", async () => {
    const conn = new CronMem();
    const res = await cronModule.run(ctxWith(conn, { name: "n", job: "/n", insertafter: "EOF", insertbefore: "BOF" }));
    expect(res.failed).toBe(true);
    expect(String(res.msg)).toContain("use only one of insertafter / insertbefore");
  });
});

describe("cron module — mode", () => {
  test("chmods a cron_file and requires cron_file", async () => {
    const conn = new CronMem();
    const res = await cronModule.run(
      ctxWith(conn, { name: "report", job: "/bin/report", cron_file: "rolecall-reports", user: "deploy", mode: "0644" }),
    );
    expect(res.changed).toBe(true);
    expect(conn.calls).toContain("chmod 0644 '/etc/cron.d/rolecall-reports'");
    expect(conn.files.get("/etc/cron.d/rolecall-reports")).toBe("#Ansible: report\n* * * * * deploy /bin/report\n");

    const bad = await cronModule.run(ctxWith(conn, { name: "nightly", job: "/bin/nightly", mode: "0644" }));
    expect(bad.failed).toBe(true);
    expect(String(bad.msg)).toContain("'mode' requires 'cron_file'");
  });
});
