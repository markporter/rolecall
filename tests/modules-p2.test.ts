// Hermetic tests for the Wave 8 builtins: `group_by`, `getent`, `pip`, `snap`,
// and `firewalld`. Every OS call is routed through an in-memory scripted
// Connection (no network, no root, no real pip/snap/firewalld), so command
// strategy and idempotency are asserted deterministically. Bun-only MVP
// (bun test).

import { describe, expect, test } from "bun:test";
import type { Connection, ExecResult } from "../src/transport/connection";
import type { ModuleContext } from "../src/executor/module";
import { getModule } from "../src/executor/module";
import { getModuleSummary } from "../src/modules/search";
import { registerAllModules } from "../src/modules/builtins/index";
import { groupByModule } from "../src/modules/builtins/group_by";
import { getentModule } from "../src/modules/builtins/getent";
import { pipModule } from "../src/modules/builtins/pip";
import { snapModule } from "../src/modules/builtins/snap";
import { firewalldModule } from "../src/modules/builtins/firewalld";

const ok = (stdout = ""): ExecResult => ({ exitCode: 0, stdout, stderr: "" });
const fail = (stderr = ""): ExecResult => ({ exitCode: 1, stdout: "", stderr: "" });

type Handler = (cmd: string) => ExecResult;

function ctxWith(
  conn: Connection,
  args: Record<string, unknown>,
  opts: {
    become?: boolean;
    addHost?: (name: string, groups: string[], vars: Record<string, unknown>) => void;
  } = {},
): ModuleContext {
  return {
    host: "h1",
    connection: conn,
    args,
    vars: {},
    facts: {},
    reg: {},
    become: opts.become ?? false,
    addHost: opts.addHost,
  };
}

/** Minimal scripted Connection that strips a leading `sudo ` before dispatching. */
class ScriptedConn implements Connection {
  readonly kind = "local";
  readonly calls: string[] = [];
  private readonly handler: Handler;

  constructor(handler: Handler) {
    this.handler = handler;
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
    return this.handler(command.replace(/^sudo /, ""));
  }
}

describe("group_by module", () => {
  test("calls addHost with key plus parents and reports unchanged", async () => {
    const added: Array<{ name: string; groups: string[]; vars: Record<string, unknown> }> = [];
    const conn = new ScriptedConn(() => ok());
    const res = await groupByModule.run(
      ctxWith(
        conn,
        { key: "rolecall_web", parents: ["rolecall_linux", "rolecall_all"] },
        { addHost: (name, groups, vars) => added.push({ name, groups, vars }) },
      ),
    );

    expect(res.changed).toBe(false);
    expect(added).toEqual([
      { name: "h1", groups: ["rolecall_web", "rolecall_linux", "rolecall_all"], vars: {} },
    ]);
    expect(res.data?.group_by).toEqual({
      key: "rolecall_web",
      parents: ["rolecall_linux", "rolecall_all"],
    });
  });

  test("accepts a comma-separated parents string", async () => {
    const added: string[][] = [];
    const conn = new ScriptedConn(() => ok());
    const res = await groupByModule.run(
      ctxWith(conn, { key: "web", parents: "linux, all" }, { addHost: (_n, groups) => added.push(groups) }),
    );

    expect(res.failed).toBeFalsy();
    expect(added).toEqual([["web", "linux", "all"]]);
  });

  test("rejects a missing key and invalid parents", async () => {
    const conn = new ScriptedConn(() => ok());
    const noKey = await groupByModule.run(ctxWith(conn, {}));
    expect(noKey.failed).toBe(true);
    expect(String(noKey.msg)).toContain("'key' is required");

    const badParents = await groupByModule.run(ctxWith(conn, { key: "web", parents: 42 }));
    expect(badParents.failed).toBe(true);
    expect(String(badParents.msg)).toContain("'parents'");
  });
});

describe("getent module", () => {
  test("parses passwd and group fields", async () => {
    const conn = new ScriptedConn((cmd) => {
      if (cmd === "getent passwd") return ok("root:x:0:0:root:/root:/bin/bash\nsshd:x:74:74::/var/empty/sshd:/sbin/nologin\n");
      if (cmd === "getent group") return ok("wheel:x:10:alice,bob\n");
      throw new Error(`unexpected command: ${cmd}`);
    });

    const passwd = await getentModule.run(ctxWith(conn, { database: "passwd" }));
    const passwdEntries = passwd.data?.getent as Array<{ raw: string; fields: Record<string, string> }>;
    expect(passwd.changed).toBe(false);
    expect(passwdEntries).toHaveLength(2);
    expect(passwdEntries[0]!.fields).toEqual({
      name: "root",
      password: "x",
      uid: "0",
      gid: "0",
      gecos: "root",
      home: "/root",
      shell: "/bin/bash",
    });

    const group = await getentModule.run(ctxWith(conn, { database: "group" }));
    const groupEntries = group.data?.getent as Array<{ raw: string; fields: Record<string, string> }>;
    expect(groupEntries[0]!.fields).toEqual({
      name: "wheel",
      password: "x",
      gid: "10",
      members: "alice,bob",
    });
  });

  test("parses hosts whitespace output, including IPv6", async () => {
    const conn = new ScriptedConn((cmd) => {
      if (cmd === "getent hosts") return ok("127.0.0.1 localhost.localdomain localhost\n::1 localhost\n");
      throw new Error(`unexpected command: ${cmd}`);
    });

    const res = await getentModule.run(ctxWith(conn, { database: "hosts" }));
    const entries = res.data?.getent as Array<{ raw: string; fields: Record<string, string> }>;
    expect(entries[0]!.fields).toEqual({ ip: "127.0.0.1", names: "localhost.localdomain localhost" });
    expect(entries[1]!.fields).toEqual({ ip: "::1", names: "localhost" });
  });

  test("passes the key and falls back to fieldN for unknown databases", async () => {
    const conn = new ScriptedConn((cmd) => {
      if (cmd === "getent passwd root") return ok("root:x:0:0:root:/root:/bin/bash\n");
      if (cmd === "getent custom") return ok("alpha:beta:gamma\n");
      throw new Error(`unexpected command: ${cmd}`);
    });

    const keyed = await getentModule.run(ctxWith(conn, { database: "passwd", key: "root" }));
    expect(conn.calls).toContain("getent passwd root");
    expect((keyed.data?.getent as unknown[])[0]).toMatchObject({ fields: { name: "root" } });

    const custom = await getentModule.run(ctxWith(conn, { database: "custom" }));
    const entries = custom.data?.getent as Array<{ fields: Record<string, string> }>;
    expect(entries[0]!.fields).toEqual({ field0: "alpha", field1: "beta", field2: "gamma" });
  });

  test("non-zero exit is an empty result, not a failure", async () => {
    const conn = new ScriptedConn(() => fail("no entries"));
    const res = await getentModule.run(ctxWith(conn, { database: "passwd", key: "nobody" }));
    expect(res.failed).toBeFalsy();
    expect(res.changed).toBe(false);
    expect(res.data?.getent).toEqual([]);
  });
});

/** In-memory pip: `show` probes, `install` adds, and `uninstall -y` removes. */
class PipConn implements Connection {
  readonly kind = "local";
  readonly calls: string[] = [];
  readonly installed = new Set<string>();

  constructor(initial: string[] = []) {
    for (const pkg of initial) this.installed.add(pkg);
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
    const show = /^(\S*pip\S*) show (\S+)$/.exec(cmd);
    if (show) return this.installed.has(show[2]!) ? ok(`Name: ${show[2]}`) : fail("WARNING: Package(s) not found");
    const uninstall = /^(\S*pip\S*) uninstall -y (\S+)$/.exec(cmd);
    if (uninstall) {
      this.installed.delete(uninstall[2]!);
      return ok(`Successfully uninstalled ${uninstall[2]}`);
    }
    const install = /^(\S*pip\S*) install (.*)$/.exec(cmd);
    if (install) {
      const tokens = (install[2] ?? "").split(/\s+/).filter(Boolean);
      const pkg = tokens[tokens.length - 1] ?? "";
      this.installed.add(pkg);
      return ok(`Successfully installed ${pkg}`);
    }
    throw new Error(`unexpected command: ${cmd}`);
  }
}

describe("pip module", () => {
  test("installs a missing package and is a no-op on re-run", async () => {
    const conn = new PipConn();
    const args = { name: "requests" };

    const first = await pipModule.run(ctxWith(conn, args));
    expect(first.changed).toBe(true);
    expect(conn.installed.has("requests")).toBe(true);
    expect(conn.calls).toContain("pip3 install requests");

    const second = await pipModule.run(ctxWith(conn, args));
    expect(second.changed).toBe(false);
    expect(conn.calls.filter((c) => c.startsWith("pip3 install")).length).toBe(1);
  });

  test("state latest installs with --upgrade and then no-ops", async () => {
    const conn = new PipConn();
    const args = { name: "flask", state: "latest" };

    const first = await pipModule.run(ctxWith(conn, args));
    expect(first.changed).toBe(true);
    expect(conn.calls).toContain("pip3 install --upgrade flask");

    const second = await pipModule.run(ctxWith(conn, args));
    expect(second.changed).toBe(false);
  });

  test("state absent uninstalls and then no-ops", async () => {
    const conn = new PipConn(["ansible"]);
    const args = { name: "ansible", state: "absent" };

    const first = await pipModule.run(ctxWith(conn, args));
    expect(first.changed).toBe(true);
    expect(conn.installed.has("ansible")).toBe(false);
    expect(conn.calls).toContain("pip3 uninstall -y ansible");

    const second = await pipModule.run(ctxWith(conn, args));
    expect(second.changed).toBe(false);
  });

  test("virtualenv selects <venv>/bin/pip and extra_args are appended", async () => {
    const conn = new PipConn();
    const res = await pipModule.run(
      ctxWith(conn, { name: "requests", virtualenv: "/opt/venv", extra_args: "--no-cache-dir" }),
    );
    expect(res.failed).toBeFalsy();
    expect(conn.calls).toContain("/opt/venv/bin/pip show requests");
    expect(conn.calls).toContain("/opt/venv/bin/pip install --no-cache-dir requests");
  });
});

/** In-memory snap: `list` probes, `install` adds, `remove` deletes. */
class SnapConn implements Connection {
  readonly kind = "local";
  readonly calls: string[] = [];
  readonly installed = new Set<string>();

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
    const list = /^snap list (\S+)$/.exec(cmd);
    if (list) return this.installed.has(list[1]!) ? ok(`Name Version Rev Tracking Publisher Notes\n${list[1]} 1.0 1 latest/stable - -`) : fail("error: no matching snaps installed");
    const install = /^snap install (\S+)( --classic)?$/.exec(cmd);
    if (install) {
      this.installed.add(install[1]!);
      return ok(`installed ${install[1]}`);
    }
    const remove = /^snap remove (\S+)$/.exec(cmd);
    if (remove) {
      this.installed.delete(remove[1]!);
      return ok(`removed ${remove[1]}`);
    }
    throw new Error(`unexpected command: ${cmd}`);
  }
}

describe("snap module", () => {
  test("installs with --classic under sudo and no-ops on re-run", async () => {
    const conn = new SnapConn();
    const args = { name: "code", classic: true };

    const first = await snapModule.run(ctxWith(conn, args, { become: true }));
    expect(first.changed).toBe(true);
    expect(conn.calls).toContain("sudo snap install code --classic");

    const second = await snapModule.run(ctxWith(conn, args, { become: true }));
    expect(second.changed).toBe(false);
  });

  test("state absent removes the snap and then no-ops", async () => {
    const conn = new SnapConn();
    conn.installed.add("core");
    const args = { name: "core", state: "absent" };

    const first = await snapModule.run(ctxWith(conn, args, { become: true }));
    expect(first.changed).toBe(true);
    expect(conn.calls).toContain("sudo snap remove core");
    expect(conn.installed.has("core")).toBe(false);

    const second = await snapModule.run(ctxWith(conn, args, { become: true }));
    expect(second.changed).toBe(false);
  });

  test("rejects an invalid state", async () => {
    const conn = new SnapConn();
    const res = await snapModule.run(ctxWith(conn, { name: "code", state: "latest" }));
    expect(res.failed).toBe(true);
    expect(String(res.msg)).toContain("invalid state");
  });
});

/** In-memory firewalld rule set keyed by `<kind>:<value>`. */
class FirewalldConn implements Connection {
  readonly kind = "local";
  readonly calls: string[] = [];
  readonly rules = new Set<string>();

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async facts(): Promise<{ host: string; user: string; transport: "local" }> {
    return { host: "h1", user: "x", transport: "local" };
  }
  async health(): Promise<{ ok: boolean }> {
    return { ok: true };
  }
  private valueOf(cmd: string, prefix: string): string {
    let raw = cmd.slice(cmd.indexOf(prefix) + prefix.length);
    const permanent = " --permanent";
    if (raw.endsWith(permanent)) raw = raw.slice(0, -permanent.length);
    return raw.replace(/^'|'$/g, "");
  }
  async exec(command: string): Promise<ExecResult> {
    this.calls.push(command);
    const cmd = command.replace(/^sudo /, "");
    const query = /--query-(service|port|rich-rule)=/.exec(cmd);
    if (query) {
      const kind = query[1]!;
      const value = this.valueOf(cmd, `--query-${kind}=`);
      return this.rules.has(`${kind}:${value}`) ? ok("yes") : fail("no");
    }
    const action = /--(add|remove)-(service|port|rich-rule)=/.exec(cmd);
    if (action) {
      const kind = action[2]!;
      const value = this.valueOf(cmd, `--${action[1]}-${kind}=`);
      const key = `${kind}:${value}`;
      if (action[1] === "add") this.rules.add(key);
      else this.rules.delete(key);
      return ok("success");
    }
    throw new Error(`unexpected command: ${cmd}`);
  }
}

describe("firewalld module", () => {
  test("adds a missing service permanently and immediately, then no-ops", async () => {
    const conn = new FirewalldConn();
    const args = { service: "http" };

    const first = await firewalldModule.run(ctxWith(conn, args));
    expect(first.changed).toBe(true);
    expect(conn.calls).toContain("firewall-cmd --zone=public --query-service=http");
    expect(conn.calls).toContain("firewall-cmd --zone=public --add-service=http --permanent");
    expect(conn.calls).toContain("firewall-cmd --zone=public --add-service=http");
    expect(conn.rules.has("service:http")).toBe(true);

    const second = await firewalldModule.run(ctxWith(conn, args));
    expect(second.changed).toBe(false);
    expect(conn.calls.filter((c) => c.includes("--add-service")).length).toBe(2);
  });

  test("state absent removes a present service permanently and immediately", async () => {
    const conn = new FirewalldConn();
    conn.rules.add("service:telnet");
    const args = { service: "telnet", state: "absent" };

    const first = await firewalldModule.run(ctxWith(conn, args));
    expect(first.changed).toBe(true);
    expect(conn.calls).toContain("firewall-cmd --zone=public --remove-service=telnet --permanent");
    expect(conn.calls).toContain("firewall-cmd --zone=public --remove-service=telnet");
    expect(conn.rules.has("service:telnet")).toBe(false);

    const second = await firewalldModule.run(ctxWith(conn, args));
    expect(second.changed).toBe(false);
  });

  test("requires exactly one of service, port, or rich_rule", async () => {
    const conn = new FirewalldConn();
    const none = await firewalldModule.run(ctxWith(conn, {}));
    expect(none.failed).toBe(true);
    expect(String(none.msg)).toContain("exactly one");
    expect(conn.calls.length).toBe(0);

    const two = await firewalldModule.run(ctxWith(conn, { service: "http", port: "80/tcp" }));
    expect(two.failed).toBe(true);
    expect(String(two.msg)).toContain("exactly one");
    expect(conn.calls.length).toBe(0);
  });

  test("a matching query for state absent is a no-op", async () => {
    const conn = new FirewalldConn();
    const res = await firewalldModule.run(ctxWith(conn, { port: "8080/tcp", state: "absent" }));
    expect(res.changed).toBe(false);
    expect(conn.calls).toEqual(["firewall-cmd --zone=public --query-port=8080/tcp"]);
  });
});

describe("builtin registration", () => {
  test("registers all five modules with search metadata", () => {
    registerAllModules();
    for (const name of ["group_by", "getent", "pip", "snap", "firewalld"]) {
      const mod = getModule(name);
      expect(mod).toBeDefined();
      expect(mod?.name).toBe(name);

      const summary = getModuleSummary(name);
      expect(summary.name).toBe(name);
      expect(summary.description.length).toBeGreaterThan(0);
      expect(Object.keys(summary.args ?? {}).length).toBeGreaterThan(0);
    }
  });
});
