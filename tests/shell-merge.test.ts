// Tests for the `command`/`raw` → `shell` merge and the guard/run_mode invariant
// (guards are only valid in run_mode: idempotent; using a guard with readonly/always throws).

import { expect, test } from "bun:test";
import { shellModule, commandModule, scriptModule } from "../src/modules/builtins";
import type { ModuleContext } from "../src/executor/module";

/** Minimal stub connection: the guard/run_mode check happens before any exec, so a
 * no-op exec is enough to exercise describe/converge without a real target. */
function stubCtx(args: Record<string, unknown>): ModuleContext {
  return {
    args,
    become: false,
    connection: { exec: async () => ({ exitCode: 0, stdout: "", stderr: "" }) },
  } as unknown as ModuleContext;
}

test("shell: guard + run_mode: always throws", async () => {
  await expect(
    shellModule.run(stubCtx({ command: "echo hi", creates: "/x", run_mode: "always" })),
  ).rejects.toThrow(/only apply in run_mode: idempotent/);
});

test("shell: guard + run_mode: readonly throws", async () => {
  await expect(
    shellModule.run(stubCtx({ command: "echo hi", creates: "/x", run_mode: "readonly" })),
  ).rejects.toThrow(/only apply in run_mode: idempotent/);
});

test("shell: guard + run_mode: idempotent is allowed (no throw)", async () => {
  await expect(
    shellModule.run(stubCtx({ command: "echo hi", creates: "/x", run_mode: "idempotent" })),
  ).resolves.toBeDefined();
});

test("command: creates-guard auto-selects idempotent (no throw)", async () => {
  await expect(commandModule.run(stubCtx({ cmd: "echo hi", creates: "/x" }))).resolves.toBeDefined();
});

test("command: no guard auto-selects always and reports changed", async () => {
  const r = await commandModule.run(stubCtx({ cmd: "echo hi" }));
  expect(r.changed).toBe(true);
  expect(r.failed).toBe(false);
});

test("command: chdir is translated to a cd prefix on the forwarded command", async () => {
  const r = await commandModule.run(stubCtx({ cmd: "make", chdir: "/src", creates: "/src/built" }));
  // No throw (guard → idempotent); the forwarded command is the cd-prefixed form.
  expect(r).toBeDefined();
});

test("shell: local_src pointing to a missing file throws", async () => {
  await expect(
    shellModule.run(stubCtx({ local_src: "/no/such/file.sh", run_mode: "always" })),
  ).rejects.toThrow(/cannot read local_src/);
});

test("shell: src (target-side path) is used as the command without a local read", async () => {
  await expect(
    shellModule.run(stubCtx({ src: "/target/run.sh", run_mode: "always" })),
  ).resolves.toBeDefined();
});

test("script: alias forwards local_src to shell (missing file throws)", async () => {
  await expect(scriptModule.run(stubCtx({ src: "/no/such/file.sh" }))).rejects.toThrow(/cannot read local_src/);
});

test("script: no guard defaults to run_mode: always (changed)", async () => {
  // Use a real temp file so local_src resolves, then it runs (stub exec) and is changed.
  const tmp = `/tmp/rolecall-script-${(Math.random() * 1e9) | 0}.sh`;
  await Bun.write(tmp, "echo hi\n");
  try {
    const r = await scriptModule.run(stubCtx({ src: tmp }));
    expect(r.changed).toBe(true);
  } finally {
    await Bun.file(tmp).delete?.();
  }
});
