import { expect, test } from "bun:test";
import { runDoctorCommand } from "../src/cli/commands/doctor";
import type { GlobalFlags } from "../src/cli/types";
import type { ProbeDeps } from "../src/isolation";

const flags = (isolation?: string): GlobalFlags => ({
  force: false,
  check: false,
  diff: false,
  output: "human_summary",
  trace: false,
  profile: false,
  isolation: isolation as GlobalFlags["isolation"],
});

const deps: Partial<ProbeDeps> = {
  platform: "linux",
  which: (cmd) => cmd === "bwrap",
  run: (_cmd, args) => ({ status: args[0] === "--unshare-user" ? 0 : 1 }),
  env: {},
};

test("doctor reports the selected isolation backend", async () => {
  const res = await runDoctorCommand(flags("auto"), [], { probeDeps: deps });
  expect(res.command).toBe("doctor");
  if (res.command !== "doctor") throw new Error("unexpected");
  expect(res.isolation.selected).toBe("namespace");
  expect(res.note).toContain("namespace");
});

test("doctor rejects an unknown backend as a usage error", async () => {
  await expect(runDoctorCommand(flags("bogus"), [], { probeDeps: deps })).rejects.toThrow(/unknown --isolation/);
});

test("doctor reports the unsafe none path without pretending it is isolated", async () => {
  const res = await runDoctorCommand(flags("none"), [], { probeDeps: deps });
  if (res.command !== "doctor") throw new Error("unexpected");
  expect(res.isolation.selected).toBe("none");
  expect(res.note).toContain("unsandboxed");
});
