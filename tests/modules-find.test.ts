// Hermetic tests for the `find` module's Ansible-parity filters (size/age/contains/
// link type): every OS call is routed through an in-memory scripted Connection that
// records commands and returns canned `find -printf` / `grep` output. Bun-only MVP.

import { expect, test } from "bun:test";
import type { ModuleContext } from "../src/executor/module";
import type { ExecResult } from "../src/transport/connection";
import { createNoopConnection } from "../src/executor/context";
import { findModule } from "../src/modules/builtins/find";

const ok = (stdout = ""): ExecResult => ({ exitCode: 0, stdout, stderr: "" });
const no = (): ExecResult => ({ exitCode: 1, stdout: "", stderr: "" });

function harness(
  args: Record<string, unknown>,
  router: (cmd: string) => ExecResult,
): { ctx: ModuleContext; calls: string[] } {
  const calls: string[] = [];
  const conn = createNoopConnection("h1");
  conn.exec = async (cmd: string): Promise<ExecResult> => {
    calls.push(cmd);
    return router(cmd);
  };
  return {
    ctx: { host: "h1", connection: conn, args, vars: {}, facts: {}, registered: {} } as ModuleContext,
    calls,
  };
}

const row = (path: string, size: number, mtime: number, type: string, mode: string): string =>
  `${path}\t${size}\t${mtime}\t${type}\t${mode}`;

test("find passes size through to -size", async () => {
  const h = harness({ paths: "/var", size: "+10M" }, (cmd) => {
    if (cmd.startsWith("find ")) return ok("");
    throw new Error(`unexpected command: ${cmd}`);
  });
  await findModule.run(h.ctx);
  expect(h.calls[0]).toContain("-size +10M");
});

test("find maps age 2d to a -mtime day predicate", async () => {
  const h = harness({ paths: "/var", age: "2d" }, (cmd) => {
    if (cmd.startsWith("find ")) return ok("");
    throw new Error(`unexpected command: ${cmd}`);
  });
  await findModule.run(h.ctx);
  expect(h.calls[0]).toContain("-mtime 2");
});

test("find maps age 3h to a -mmin minute predicate", async () => {
  const h = harness({ paths: "/var", age: "3h" }, (cmd) => {
    if (cmd.startsWith("find ")) return ok("");
    throw new Error(`unexpected command: ${cmd}`);
  });
  await findModule.run(h.ctx);
  expect(h.calls[0]).toContain("-mmin 180");
});

test("find maps file_type link to -type l", async () => {
  const h = harness({ paths: "/var", file_type: "link" }, (cmd) => {
    if (cmd.startsWith("find ")) return ok("");
    throw new Error(`unexpected command: ${cmd}`);
  });
  await findModule.run(h.ctx);
  expect(h.calls[0]).toContain("-type l");
});

test("find contains keeps only matching regular files", async () => {
  const h = harness({ paths: "/a", contains: "ERROR" }, (cmd) => {
    if (cmd.startsWith("find ")) {
      return ok(
        [
          row("/a/f1.txt", 3, 111, "f", "644"),
          row("/a/f2.txt", 3, 111, "f", "644"),
          row("/a/d1", 0, 111, "d", "755"),
        ].join("\n"),
      );
    }
    if (cmd.startsWith("grep -q -E ")) {
      return cmd.includes("/a/f1.txt") ? ok() : no();
    }
    throw new Error(`unexpected command: ${cmd}`);
  });

  const res = await findModule.run(h.ctx);
  const files = res.data?.["files"] as Array<{ path: string }>;
  expect(files.length).toBe(1);
  expect(files[0]?.path).toBe("/a/f1.txt");
  const greps = h.calls.filter((c) => c.startsWith("grep -q -E "));
  expect(greps.length).toBe(2);
  expect(greps.some((c) => c.includes("/a/d1"))).toBe(false);
});

test("find fails on an invalid age instead of ignoring it", async () => {
  const h = harness({ paths: "/var", age: "soon" }, (cmd) => {
    throw new Error(`unexpected command: ${cmd}`);
  });
  const res = await findModule.run(h.ctx);
  expect(res.failed).toBe(true);
  expect(String(res.msg)).toContain("invalid age");
  expect(h.calls.length).toBe(0);
});
