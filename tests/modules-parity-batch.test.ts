// Ansible-parity batch: additive argument coverage for editing modules and the
// pure debug/assert/find/pam_limits surfaces. Uses real local transport for
// filesystem behavior and a recording connection where only argv matters.

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";

import type { Connection, ExecResult } from "../src/transport/connection";
import type { ModuleContext } from "../src/executor/module";
import { createConnection } from "../src/transport";
import { lineinfileModule } from "../src/modules/builtins/lineinfile";
import { blockinfileModule } from "../src/modules/builtins/blockinfile";
import { configEditModule } from "../src/modules/builtins/config_edit";
import { fileModule } from "../src/modules/builtins/file";
import { findModule } from "../src/modules/builtins/find";
import { assertModule } from "../src/modules/builtins/assert";
import { debugModule } from "../src/modules/builtins/debug";
import { pamLimitsModule } from "../src/modules/builtins/pam_limits";
import { unarchiveModule } from "../src/modules/builtins/unarchive";
import { waitForConnectionModule } from "../src/modules/builtins/wait_for_connection";
import { pamdModule } from "../src/modules/builtins/pamd";
import { aptKeyModule } from "../src/modules/builtins/apt_key";
import { debconfModule } from "../src/modules/builtins/debconf";

const ok = (stdout = ""): ExecResult => ({ exitCode: 0, stdout, stderr: "" });

function ctx(conn: Connection, args: Record<string, unknown>): ModuleContext {
  return {
    host: "h1",
    connection: conn,
    args,
    vars: {},
    facts: {},
    registered: {},
  } as unknown as ModuleContext;
}

function localCtx(args: Record<string, unknown>): ModuleContext {
  return ctx(createConnection({ kind: "local", host: "h1", user: "ci" }), args);
}

const tmp = (suffix: string) => join(tmpdir(), `rolecall-parity-${randomUUID()}${suffix}`);

/** Connection that records commands and returns empty success (or a scripted result). */
class RecordingConnection implements Connection {
  readonly kind = "local";
  readonly commands: string[] = [];
  constructor(private readonly respond: (cmd: string) => ExecResult = () => ok()) {}
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async facts(): Promise<{ host: string; user: string; transport: "local" }> {
    return { host: "h1", user: "ci", transport: "local" };
  }
  async health(): Promise<{ ok: boolean }> {
    return { ok: true };
  }
  async exec(command: string): Promise<ExecResult> {
    this.commands.push(command);
    return this.respond(command);
  }
}

describe("lineinfile parity", () => {
  test("absent file fails unless create is true", async () => {
    const path = tmp(".cfg");
    const res = await lineinfileModule.run(localCtx({ path, line: "FOO=bar" }));
    expect(res.failed).toBe(true);
    expect(res.msg).toContain("create: true");
  });

  test("create: true writes the line; dest aliases path", async () => {
    const path = tmp(".cfg");
    const res = await lineinfileModule.run(
      localCtx({ dest: path, line: "FOO=bar", create: true }),
    );
    expect(res.changed).toBe(true);
    expect(await Bun.file(path).text()).toBe("FOO=bar\n");
  });
});

describe("blockinfile insertbefore", () => {
  test("inserts before the LAST matching line", async () => {
    const path = tmp(".conf");
    await Bun.write(path, "alpha\nTARGET\nbeta\nTARGET\ngamma\n");
    const res = await blockinfileModule.run(
      localCtx({ path, block: "INSERTED", insertbefore: "TARGET" }),
    );
    expect(res.changed).toBe(true);
    const lines = (await Bun.file(path).text()).split("\n").filter(Boolean);
    expect(lines.indexOf("# RoleCall BLOCK BEGIN block")).toBeGreaterThanOrEqual(0);
    expect(lines[lines.indexOf("# RoleCall BLOCK BEGIN block") + 1]).toBe("INSERTED");
    expect(lines[lines.lastIndexOf("TARGET") - 1]).toBe("# RoleCall BLOCK END block");
  });
});

describe("config_edit ini_file parity", () => {
  test("section/option write with create: true and is idempotent", async () => {
    const path = tmp(".conf");
    const args = {
      path,
      format: "ini",
      section: "general",
      option: "pass4SymmKey",
      value: "secret",
      create: true,
    };
    const first = await configEditModule.run(localCtx(args));
    expect(first.changed).toBe(true);
    expect(await Bun.file(path).text()).toContain("pass4SymmKey = secret");
    const second = await configEditModule.run(localCtx(args));
    expect(second.changed).toBe(false);
    expect(second.data?.idempotent).toBe(true);
  });

  test("ini_file form defaults create to false", async () => {
    const path = tmp(".conf");
    const res = await configEditModule.run(
      localCtx({ path, format: "ini", section: "general", option: "x", value: "y" }),
    );
    expect(res.failed).toBe(true);
    expect(res.msg).toContain("create: true");
  });
});

describe("find patterns alias", () => {
  test("combines patterns with -o", async () => {
    const conn = new RecordingConnection();
    await findModule.run(ctx(conn, { paths: "/etc", patterns: ["*.conf", "*.ini"] }));
    expect(conn.commands[0]).toContain("\\( -name '*.conf' -o -name '*.ini' \\)");
  });
});

describe("assert / debug parity", () => {
  test("assert fail_msg overrides msg and success_msg is reported", async () => {
    const failed = await assertModule.run(
      ctx(new RecordingConnection(), { that: false, msg: "legacy", fail_msg: "new" }),
    );
    expect(failed.failed).toBe(true);
    expect(failed.msg).toBe("new");
    const passed = await assertModule.run(
      ctx(new RecordingConnection(), { that: true, success_msg: "all good" }),
    );
    expect(passed.failed).not.toBe(true);
    expect(passed.msg).toBe("all good");
  });

  test("debug var is surfaced under var", async () => {
    const res = await debugModule.run(ctx(new RecordingConnection(), { var: "hello" }));
    expect(res.data?.var).toBe("hello");
    expect(res.stdout).toBe('{"var":"hello"}');
  });
});

describe("pam_limits aliases", () => {
  test("limit_type/limit_item map to type/item", async () => {
    const conn = new RecordingConnection((cmd) =>
      cmd.includes("grep -qxF") ? { exitCode: 1, stdout: "", stderr: "" } : ok(),
    );
    const res = await pamLimitsModule.run(
      ctx(conn, {
        domain: "*",
        limit_type: "soft",
        limit_item: "nofile",
        value: "65536",
      }),
    );
    expect(res.changed).toBe(true);
    expect(conn.commands.some((c) => c.includes("* soft nofile 65536"))).toBe(true);
  });
});

describe("file dest alias", () => {
  test("dest creates the directory", async () => {
    const path = tmp("-dir");
    const res = await fileModule.run(localCtx({ dest: path, state: "directory" }));
    expect(res.changed).toBe(true);
    expect(res.data?.path).toBe(path);
  });
});

describe("unarchive remote_src", () => {
  test("remote_src: false fails with staging guidance", async () => {
    const res = await unarchiveModule.run(
      ctx(new RecordingConnection(), { src: "/tmp/a.tgz", dest: "/tmp/x", remote_src: false }),
    );
    expect(res.failed).toBe(true);
    expect(res.msg).toContain("stage the archive with copy");
  });
});

describe("wait_for_connection", () => {
  test("retries until the transport succeeds", async () => {
    let attempts = 0;
    const conn = new RecordingConnection(() => {
      attempts += 1;
      return attempts >= 3 ? ok() : { exitCode: 1, stdout: "", stderr: "not ready" };
    });
    const res = await waitForConnectionModule.run(
      ctx(conn, { timeout: 5, sleep: 0.001 }),
    );
    expect(res.failed).not.toBe(true);
    expect(res.data?.attempts).toBe(3);
  });
});

describe("pamd", () => {
  test("writes a rule and is idempotent; absent removes it", async () => {
    const dir = tmp("-pamd");
    mkdirSync(dir, { recursive: true });
    const args = {
      name: "sshd",
      type: "auth",
      control: "required",
      module_path: "pam_unix.so",
      path: dir,
    };
    const first = await pamdModule.run(localCtx(args));
    expect(first.changed).toBe(true);
    const file = `${dir}/sshd`;
    expect(await Bun.file(file).text()).toContain("auth required pam_unix.so");
    const second = await pamdModule.run(localCtx(args));
    expect(second.changed).toBe(false);
    const removed = await pamdModule.run(localCtx({ ...args, state: "absent" }));
    expect(removed.changed).toBe(true);
    expect(await Bun.file(file).text()).not.toContain("pam_unix.so");
  });
});

describe("apt_key / debconf validation", () => {
  test("apt_key requires a key source", async () => {
    const res = await aptKeyModule.run(ctx(new RecordingConnection(), {}));
    expect(res.failed).toBe(true);
    expect(res.msg).toContain("one of 'url', 'data'");
  });

  test("debconf writes a selection line", async () => {
    const conn = new RecordingConnection((cmd) =>
      cmd.includes("debconf-show") ? ok("* pkg/question: old\n") : ok(),
    );
    const res = await debconfModule.run(
      ctx(conn, {
        name: "pkg",
        question: "pkg/question",
        vtype: "boolean",
        value: "true",
      }),
    );
    expect(res.changed).toBe(true);
    expect(conn.commands.some((c) => c.includes("pkg pkg/question boolean true"))).toBe(true);
  });
});
