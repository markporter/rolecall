// `shell_register` — observation/probe semantics replacing Ansible
// changed_when:false + failed_when:false + register.

import { describe, expect, test } from "bun:test";
import { createConnection } from "../src/transport";
import type { ModuleContext } from "../src/executor/module";
import { shellRegisterModule } from "../src/modules/builtins/shell_register";

function ctx(args: Record<string, unknown>): ModuleContext {
  return {
    host: "h1",
    connection: createConnection({ kind: "local", host: "h1", user: "ci" }),
    args,
    vars: {},
    facts: {},
    registered: {},
  } as unknown as ModuleContext;
}

describe("shell_register", () => {
  test("captures stdout/rc with changed:false by default", async () => {
    const res = await shellRegisterModule.run(ctx({ command: "echo hi" }));
    expect(res.failed).not.toBe(true);
    expect(res.changed).toBe(false);
    expect(res.stdout).toBe("hi\n");
    expect((res.data as Record<string, unknown>).rc).toBe(0);
  });

  test("fails on non-zero rc unless capture_errors is true", async () => {
    const failed = await shellRegisterModule.run(ctx({ command: "exit 3" }));
    expect(failed.failed).toBe(true);
    const captured = await shellRegisterModule.run(
      ctx({ command: "exit 3", capture_errors: true }),
    );
    expect(captured.failed).not.toBe(true);
    expect(captured.changed).toBe(false);
    expect((captured.data as Record<string, unknown>).rc).toBe(3);
  });

  test("changed:true reports a mutation", async () => {
    const res = await shellRegisterModule.run(ctx({ command: "true", changed: true }));
    expect(res.changed).toBe(true);
    expect(res.failed).not.toBe(true);
  });

  test("check mode skips a mutating probe", async () => {
    const res = await shellRegisterModule.run(ctx({ command: "true", changed: true, _check: true }));
    expect(res.skipped).toBe(true);
    expect((res.data as Record<string, unknown>).wouldChange).toBe(true);
  });
});
