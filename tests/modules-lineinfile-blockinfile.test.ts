// Hermetic tests for the file-editing builtins `lineinfile` (insertafter /
// insertbefore anchors) and `blockinfile` (Ansible marker opt-in). Every OS call
// is routed through an in-memory scripted Connection (no network, no root), so
// the exact write strategy and idempotency behaviour are asserted deterministically.
// Bun-only MVP (bun test).

import { describe, expect, test } from "bun:test";
import type { Connection, ExecResult } from "../src/transport/connection";
import type { ModuleContext } from "../src/executor/module";
import { lineinfileModule } from "../src/modules/builtins/lineinfile";
import { blockinfileModule } from "../src/modules/builtins/blockinfile";

const ok = (stdout = ""): ExecResult => ({ exitCode: 0, stdout, stderr: "" });
const fail = (stderr = "not found"): ExecResult => ({ exitCode: 1, stdout: "", stderr });

function ctxWith(conn: Connection, args: Record<string, unknown>, become = false): ModuleContext {
  return { host: "h1", connection: conn, args, vars: {}, facts: {}, registered: {}, become } as unknown as ModuleContext;
}

/** In-memory POSIX filesystem: `cat` reads and quoted-heredoc writes. */
class MemFs implements Connection {
  readonly kind = "local";
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
    const cmd = command.replace(/^sudo /, "");
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
    throw new Error(`MemFs: unexpected command: ${cmd}`);
  }
}

function linesOf(conn: MemFs, path: string): string[] {
  return conn.files.get(path)!.split("\n").filter((l) => l !== "");
}

describe("lineinfile anchors", () => {
  const seed = "alpha\nbeta\nTARGET marker\nbeta again\ngamma\n";

  test("insertafter regex inserts after the LAST matching line", async () => {
    const conn = new MemFs();
    const path = "/etc/demo.cfg";
    conn.files.set(path, seed);
    const res = await lineinfileModule.run(
      ctxWith(conn, { path, line: "INSERTED", insertafter: "beta" }),
    );
    expect(res.changed).toBe(true);
    const lines = linesOf(conn, path);
    expect(lines.indexOf("INSERTED")).toBe(lines.indexOf("beta again") + 1);
    expect(lines[lines.length - 1]).toBe("gamma");
  });

  test("insertbefore regex inserts before the LAST matching line", async () => {
    const conn = new MemFs();
    const path = "/etc/demo.cfg";
    conn.files.set(path, seed);
    const res = await lineinfileModule.run(
      ctxWith(conn, { path, line: "INSERTED", insertbefore: "gamma" }),
    );
    expect(res.changed).toBe(true);
    const lines = linesOf(conn, path);
    expect(lines.indexOf("INSERTED")).toBe(lines.indexOf("gamma") - 1);
  });

  test("insertbefore BOF and START prepend at the beginning", async () => {
    for (const anchor of ["BOF", "START"]) {
      const conn = new MemFs();
      const path = "/etc/demo.cfg";
      conn.files.set(path, seed);
      const res = await lineinfileModule.run(
        ctxWith(conn, { path, line: "FIRST", insertbefore: anchor }),
      );
      expect(res.changed).toBe(true);
      expect(linesOf(conn, path)[0]).toBe("FIRST");
    }
  });

  test("unmatched anchor appends at EOF", async () => {
    const conn = new MemFs();
    const path = "/etc/demo.cfg";
    conn.files.set(path, seed);
    const res = await lineinfileModule.run(
      ctxWith(conn, { path, line: "INSERTED", insertbefore: "no-such-anchor" }),
    );
    expect(res.changed).toBe(true);
    const lines = linesOf(conn, path);
    expect(lines[lines.length - 1]).toBe("INSERTED");
  });

  test("insertafter EOF appends at EOF", async () => {
    const conn = new MemFs();
    const path = "/etc/demo.cfg";
    conn.files.set(path, seed);
    const res = await lineinfileModule.run(
      ctxWith(conn, { path, line: "INSERTED", insertafter: "EOF" }),
    );
    expect(res.changed).toBe(true);
    expect(linesOf(conn, path).at(-1)).toBe("INSERTED");
  });

  test("setting both insertafter and insertbefore fails", async () => {
    const conn = new MemFs();
    const path = "/etc/demo.cfg";
    conn.files.set(path, seed);
    const res = await lineinfileModule.run(
      ctxWith(conn, { path, line: "X", insertafter: "beta", insertbefore: "gamma" }),
    );
    expect(res.changed).toBe(false);
    expect(res.failed).toBe(true);
    expect(res.msg).toBe("lineinfile: use only one of insertafter / insertbefore");
  });

  test("anchor insertion is idempotent on a second run", async () => {
    const conn = new MemFs();
    const path = "/etc/demo.cfg";
    conn.files.set(path, seed);
    const args = { path, line: "INSERTED", insertafter: "beta" };
    const first = await lineinfileModule.run(ctxWith(conn, args));
    expect(first.changed).toBe(true);
    const second = await lineinfileModule.run(ctxWith(conn, args));
    expect(second.changed).toBe(false);
    expect(second.data?.idempotent).toBe(true);
    expect(linesOf(conn, path).filter((l) => l === "INSERTED").length).toBe(1);
  });

  test("regexp match still replaces the line", async () => {
    const conn = new MemFs();
    const path = "/etc/demo.cfg";
    conn.files.set(path, "key=old\nother\n");
    const res = await lineinfileModule.run(
      ctxWith(conn, { path, line: "key=new", regexp: "^key=" }),
    );
    expect(res.changed).toBe(true);
    expect(linesOf(conn, path)).toEqual(["key=new", "other"]);
  });
});

describe("blockinfile ansible markers", () => {
  test("ansible_marker present writes the Ansible markers", async () => {
    const conn = new MemFs();
    const path = "/etc/hosts";
    const res = await blockinfileModule.run(
      ctxWith(conn, { path, block: "10.0.0.1 host1", ansible_marker: true }),
    );
    expect(res.changed).toBe(true);
    const content = conn.files.get(path)!;
    expect(content).toContain("# BEGIN ANSIBLE MANAGED BLOCK");
    expect(content).toContain("# END ANSIBLE MANAGED BLOCK");
    expect(content).not.toContain("RoleCall BLOCK");
  });

  test("ansible_marker second run is a no-op", async () => {
    const conn = new MemFs();
    const path = "/etc/hosts";
    const args = { path, block: "10.0.0.1 host1", ansible_marker: true };
    const first = await blockinfileModule.run(ctxWith(conn, args));
    expect(first.changed).toBe(true);
    const second = await blockinfileModule.run(ctxWith(conn, args));
    expect(second.changed).toBe(false);
    expect(second.data?.idempotent).toBe(true);
  });

  test("absent removes the Ansible-marked block", async () => {
    const conn = new MemFs();
    const path = "/etc/hosts";
    await blockinfileModule.run(
      ctxWith(conn, { path, block: "10.0.0.1 host1", ansible_marker: true }),
    );
    const res = await blockinfileModule.run(
      ctxWith(conn, { path, block: "10.0.0.1 host1", ansible_marker: true, state: "absent" }),
    );
    expect(res.changed).toBe(true);
    expect(conn.files.get(path)!).not.toContain("# BEGIN ANSIBLE MANAGED BLOCK");
  });

  test("default mode still uses RoleCall markers", async () => {
    const conn = new MemFs();
    const path = "/etc/hosts";
    const res = await blockinfileModule.run(ctxWith(conn, { path, block: "10.0.0.1 host1" }));
    expect(res.changed).toBe(true);
    const content = conn.files.get(path)!;
    expect(content).toContain("# RoleCall BLOCK BEGIN block");
    expect(content).toContain("# RoleCall BLOCK END block");
    expect(content).not.toContain("ANSIBLE MANAGED BLOCK");
  });
});
