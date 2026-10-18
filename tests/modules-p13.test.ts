// Hermetic tests for the P13 idempotent builtins: `cron`, `apt_repository`,
// `yum_repository`. Every OS call is routed through an in-memory scripted
// Connection (no network, no root, no real crontab/apt/yum), so the exact remote
// command strategy and idempotency behaviour are asserted deterministically.
// Bun-only MVP (bun test).

import { describe, expect, test } from "bun:test";
import type { Connection, ExecResult } from "../src/transport/connection";
import type { ModuleContext } from "../src/executor/module";
import { cronModule } from "../src/modules/builtins/cron";
import { aptRepositoryModule } from "../src/modules/builtins/apt_repository";
import { yumRepositoryModule } from "../src/modules/builtins/yum_repository";

const ok = (stdout = ""): ExecResult => ({ exitCode: 0, stdout, stderr: "" });
const fail = (stderr = "not found"): ExecResult => ({ exitCode: 1, stdout: "", stderr });

function ctxWith(conn: Connection, args: Record<string, unknown>, become = false): ModuleContext {
  return { host: "h1", connection: conn, args, vars: {}, facts: {}, registered: {}, become } as unknown as ModuleContext;
}

/** In-memory crontab: answers `crontab -l` reads and `crontab -` heredoc writes. */
class CronMem implements Connection {
  readonly kind = "local";
  readonly calls: string[] = [];
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
    if (/^crontab -l -u '[^']*' 2>\/dev\/null$/.test(cmd)) {
      return this.tab ? ok(this.tab) : fail("no crontab for user");
    }
    const empty = cmd.match(/^crontab -u '[^']*' - <<'([^']+)'\n\1$/);
    if (empty) {
      this.tab = "";
      return ok();
    }
    const write = cmd.match(/^crontab -u '[^']*' - <<'([^']+)'\n([\s\S]*)\n\1$/);
    if (write) {
      this.tab = write[2]! + "\n";
      return ok();
    }
    throw new Error(`CronMem: unexpected command: ${cmd}`);
  }
}

/** In-memory POSIX filesystem: `cat` reads, quoted-heredoc writes, `rm -f`, `mkdir -p`. */
class MemFs implements Connection {
  readonly kind = "local";
  readonly calls: string[] = [];
  readonly files = new Map<string, string>();

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
    const cat = cmd.match(/^cat '([^']*)' 2>\/dev\/null$/);
    if (cat) {
      const content = this.files.get(cat[1]!);
      return content === undefined ? fail("No such file or directory") : ok(content);
    }
    if (/^mkdir -p '[^']*'$/.test(cmd)) return ok();
    const rm = cmd.match(/^rm -f '([^']*)'$/);
    if (rm) {
      this.files.delete(rm[1]!);
      return ok();
    }
    const write = cmd.match(/^cat > '([^']*)' <<'([^']+)'\n([\s\S]*)\n\2$/);
    if (write) {
      this.files.set(write[1]!, write[3]! + "\n");
      return ok();
    }
    if (/^apt-get update$/.test(cmd)) return ok();
    throw new Error(`MemFs: unexpected command: ${cmd}`);
  }
}

describe("cron module", () => {
  test("creates a marked entry and is idempotent on re-run", async () => {
    const conn = new CronMem();
    const args = { name: "nightly", job: "/bin/nightly", minute: "0", hour: "2", user: "root" };
    const first = await cronModule.run(ctxWith(conn, args));
    expect(first.changed).toBe(true);
    expect(conn.tab).toBe("#Ansible: nightly\n0 2 * * * /bin/nightly\n");

    const second = await cronModule.run(ctxWith(conn, args));
    expect(second.changed).toBe(false);
    expect(second.data?.idempotent).toBe(true);
    expect(conn.tab.split("#Ansible: nightly").length - 1).toBe(1);
  });

  test("modifies only the managed entry and preserves unrelated lines", async () => {
    const conn = new CronMem("MAILTO=ops\n0 5 * * * /keep\n#Ansible: nightly\n0 2 * * * /old\n");
    const res = await cronModule.run(
      ctxWith(conn, { name: "nightly", job: "/bin/new", minute: "15", hour: "3", user: "root" }),
    );
    expect(res.changed).toBe(true);
    expect(conn.tab).toContain("MAILTO=ops\n");
    expect(conn.tab).toContain("0 5 * * * /keep\n");
    expect(conn.tab).toContain("#Ansible: nightly\n15 3 * * * /bin/new\n");
    expect(conn.tab).not.toContain("/old");
  });

  test("disabled comments the entry out instead of removing it", async () => {
    const conn = new CronMem();
    const res = await cronModule.run(
      ctxWith(conn, { name: "nightly", job: "/bin/nightly", minute: "0", hour: "2", disabled: true }),
    );
    expect(res.changed).toBe(true);
    expect(conn.tab).toContain("0 2 * * * /bin/nightly");
    expect(conn.tab).toContain("#0 2 * * * /bin/nightly");
  });

  test("state=absent removes only the named entry", async () => {
    const conn = new CronMem("#Ansible: nightly\n0 2 * * * /bin/nightly\n0 9 * * * /keep\n");
    const res = await cronModule.run(ctxWith(conn, { name: "nightly", state: "absent" }));
    expect(res.changed).toBe(true);
    expect(conn.tab).toBe("0 9 * * * /keep\n");

    const again = await cronModule.run(ctxWith(conn, { name: "nightly", state: "absent" }));
    expect(again.changed).toBe(false);
  });

  test("special_time presets the schedule and rejects unknown presets", async () => {
    const conn = new CronMem();
    const res = await cronModule.run(ctxWith(conn, { name: "boot", job: "/bin/boot", special_time: "reboot" }));
    expect(res.changed).toBe(true);
    expect(conn.tab).toContain("@reboot /bin/boot");

    const bad = await cronModule.run(ctxWith(conn, { name: "x", job: "/bin/x", special_time: "fortnightly" }));
    expect(bad.failed).toBe(true);
    expect(String(bad.msg)).toContain("unsupported special_time");
  });

  test("check mode reports wouldChange without writing", async () => {
    const conn = new CronMem();
    const res = await cronModule.run(
      ctxWith(conn, { name: "nightly", job: "/bin/nightly", _check: true }),
    );
    expect(res.skipped).toBe(true);
    expect(res.data?.wouldChange).toBe(true);
    expect(conn.tab).toBe("");
  });

  test("fails clearly when job is missing for state=present", async () => {
    const conn = new CronMem();
    const res = await cronModule.run(ctxWith(conn, { name: "nightly" }));
    expect(res.failed).toBe(true);
    expect(String(res.msg)).toContain("'job' is required");
  });

  test("check() reports inDesired against the live crontab", async () => {
    const conn = new CronMem("#Ansible: nightly\n0 2 * * * /bin/nightly\n");
    const hit = await cronModule.check!({ name: "nightly", job: "/bin/nightly", minute: "0", hour: "2" }, ctxWith(conn, {}, false));
    expect(hit.inDesired).toBe(true);
    const miss = await cronModule.check!({ name: "nightly", job: "/bin/other", minute: "0", hour: "2" }, ctxWith(conn, {}, false));
    expect(miss.inDesired).toBe(false);
  });

  test("cron_file manages /etc/cron.d and includes the user column", async () => {
    const conn = new MemFs();
    const args = { name: "report", job: "/bin/report", minute: "30", hour: "1", cron_file: "rolecall-reports", user: "deploy" };
    const first = await cronModule.run(ctxWith(conn, args));
    expect(first.changed).toBe(true);
    const file = conn.files.get("/etc/cron.d/rolecall-reports");
    expect(file).toBe("#Ansible: report\n30 1 * * * deploy /bin/report\n");

    const second = await cronModule.run(ctxWith(conn, args));
    expect(second.changed).toBe(false);
  });
});

describe("apt_repository module", () => {
  const line = "deb http://apt.nginx.org/ubuntu jammy nginx";

  test("creates a sources.list.d file and is idempotent on re-run", async () => {
    const conn = new MemFs();
    const args = { repo: line, filename: "nginx.list" };
    const first = await aptRepositoryModule.run(ctxWith(conn, args));
    expect(first.changed).toBe(true);
    expect(conn.files.get("/etc/apt/sources.list.d/nginx.list")).toBe(line + "\n");

    const second = await aptRepositoryModule.run(ctxWith(conn, args));
    expect(second.changed).toBe(false);
  });

  test("appends the .list extension and preserves unrelated lines", async () => {
    const conn = new MemFs();
    conn.files.set("/etc/apt/sources.list.d/rolecall.list", "deb http://old.example/ stable main\n");
    const res = await aptRepositoryModule.run(ctxWith(conn, { repo: line, filename: "rolecall" }));
    expect(res.changed).toBe(true);
    const content = conn.files.get("/etc/apt/sources.list.d/rolecall.list")!;
    expect(content).toContain("deb http://old.example/ stable main");
    expect(content).toContain(line);
  });

  test("state=absent removes only the managed line (and the file when empty)", async () => {
    const conn = new MemFs();
    conn.files.set("/etc/apt/sources.list.d/nginx.list", line + "\n");
    const res = await aptRepositoryModule.run(ctxWith(conn, { repo: line, filename: "nginx.list", state: "absent" }));
    expect(res.changed).toBe(true);
    expect(conn.files.has("/etc/apt/sources.list.d/nginx.list")).toBe(false);
  });

  test("validate_certs false rewrites the line with [trusted=yes]", async () => {
    const conn = new MemFs();
    const res = await aptRepositoryModule.run(
      ctxWith(conn, { repo: line, filename: "nginx.list", validate_certs: false }),
    );
    expect(res.changed).toBe(true);
    expect(conn.files.get("/etc/apt/sources.list.d/nginx.list")).toBe(
      "deb [trusted=yes] http://apt.nginx.org/ubuntu jammy nginx\n",
    );
  });

  test("update_cache runs apt-get update after a change", async () => {
    const conn = new MemFs();
    const res = await aptRepositoryModule.run(
      ctxWith(conn, { repo: line, filename: "nginx.list", update_cache: true }),
    );
    expect(res.changed).toBe(true);
    expect(conn.calls.some((c) => c === "apt-get update")).toBe(true);
  });

  test("check mode reports wouldChange without writing", async () => {
    const conn = new MemFs();
    const res = await aptRepositoryModule.run(
      ctxWith(conn, { repo: line, filename: "nginx.list", _check: true }),
    );
    expect(res.skipped).toBe(true);
    expect(res.data?.wouldChange).toBe(true);
    expect(conn.files.size).toBe(0);
  });

  test("fails clearly without repo", async () => {
    const conn = new MemFs();
    const res = await aptRepositoryModule.run(ctxWith(conn, {}));
    expect(res.failed).toBe(true);
    expect(String(res.msg)).toContain("'repo' is required");
  });
});

describe("yum_repository module", () => {
  const base = "/etc/yum.repos.d/nginx-stable.repo";
  const args = {
    name: "nginx-stable",
    description: "nginx stable",
    baseurl: "http://nginx.org/packages/centos/7/$basearch/",
    gpgcheck: false,
    enabled: true,
  };

  test("writes an INI section and is idempotent on re-run", async () => {
    const conn = new MemFs();
    const first = await yumRepositoryModule.run(ctxWith(conn, args));
    expect(first.changed).toBe(true);
    const content = conn.files.get(base)!;
    expect(content).toContain("[nginx-stable]");
    expect(content).toContain("name=nginx stable");
    expect(content).toContain("baseurl=http://nginx.org/packages/centos/7/$basearch/");
    expect(content).toContain("gpgcheck=0");
    expect(content).toContain("enabled=1");

    const second = await yumRepositoryModule.run(ctxWith(conn, args));
    expect(second.changed).toBe(false);
  });

  test("modifies the section in place and preserves other sections", async () => {
    const conn = new MemFs();
    conn.files.set(
      base,
      "[base]\nname=Base\nenabled=1\n\n[nginx-stable]\nname=nginx stable\nbaseurl=http://old/\ngpgcheck=0\nenabled=1\n",
    );
    const res = await yumRepositoryModule.run(ctxWith(conn, { ...args, baseurl: "http://new/" }));
    expect(res.changed).toBe(true);
    const content = conn.files.get(base)!;
    expect(content).toContain("[base]\nname=Base\nenabled=1");
    expect(content).toContain("baseurl=http://new/");
    expect(content).not.toContain("http://old/");
    expect(content.split("[nginx-stable]").length - 1).toBe(1);
  });

  test("state=absent removes only the named section (file when empty)", async () => {
    const conn = new MemFs();
    conn.files.set(base, "[nginx-stable]\nname=nginx stable\nenabled=1\n");
    const res = await yumRepositoryModule.run(ctxWith(conn, { name: "nginx-stable", state: "absent" }));
    expect(res.changed).toBe(true);
    expect(conn.files.has(base)).toBe(false);
  });

  test("writes optional gpgkey and repo_gpgcheck fields", async () => {
    const conn = new MemFs();
    await yumRepositoryModule.run(
      ctxWith(conn, { name: "epel", mirrorlist: "https://mirrors.example/epel", gpgcheck: true, repo_gpgcheck: true, gpgkey: "https://example/key" }),
    );
    const content = conn.files.get("/etc/yum.repos.d/epel.repo")!;
    expect(content).toContain("name=epel");
    expect(content).toContain("mirrorlist=https://mirrors.example/epel");
    expect(content).toContain("gpgcheck=1");
    expect(content).toContain("repo_gpgcheck=1");
    expect(content).toContain("gpgkey=https://example/key");
  });

  test("check mode reports wouldChange without writing", async () => {
    const conn = new MemFs();
    const res = await yumRepositoryModule.run(ctxWith(conn, { ...args, _check: true }));
    expect(res.skipped).toBe(true);
    expect(res.data?.wouldChange).toBe(true);
    expect(conn.files.size).toBe(0);
  });

  test("fails clearly without a repository URL", async () => {
    const conn = new MemFs();
    const res = await yumRepositoryModule.run(ctxWith(conn, { name: "empty" }));
    expect(res.failed).toBe(true);
    expect(String(res.msg)).toContain("one of 'baseurl', 'mirrorlist', or 'metalink'");
  });

  test("check() reports inDesired against the live repo file", async () => {
    const conn = new MemFs();
    conn.files.set(base, "[nginx-stable]\nname=nginx stable\nbaseurl=http://nginx.org/packages/centos/7/$basearch/\ngpgcheck=0\nenabled=1\n");
    const hit = await yumRepositoryModule.check!(args, ctxWith(conn, {}, false));
    expect(hit.inDesired).toBe(true);
    const miss = await yumRepositoryModule.check!({ ...args, enabled: false }, ctxWith(conn, {}, false));
    expect(miss.inDesired).toBe(false);
  });
});
