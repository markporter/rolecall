import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPluginCommand } from "../src/cli/commands/plugin";
import {
  CliError,
  type GlobalFlags,
  type PluginListResult,
  type PluginRegisterResult,
} from "../src/cli/types";
import { getModule } from "../src/executor/module";
import { listPlugins } from "../src/store/plugin-store";

let rolecallHome: string;

beforeAll(() => {
  rolecallHome = mkdtempSync(join(tmpdir(), "rolecall-cli-"));
  process.env.ROLECALL_HOME = rolecallHome;
});

afterAll(() => {
  delete process.env.ROLECALL_HOME;
  rmSync(rolecallHome, { recursive: true, force: true });
});

const flags = {} as GlobalFlags;

test("register persists a user module and makes it dispatchable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rolecall-mod-"));
  const modPath = join(dir, "demomod.ts");
  writeFileSync(modPath, `export default { name: "demomod", run: async () => ({ changed: false }) };\n`);
  try {
    const res = (await runPluginCommand(["register", "demomod", "--path", modPath, "--global"], flags)) as PluginRegisterResult;
    expect(res.command).toBe("plugin register");
    expect(res.registered).toBe(true);
    expect(res.name).toBe("demomod");
    expect(getModule("demomod")).toBeDefined();
    const listed = listPlugins({ globalRoot: join(rolecallHome, ".rolecall") });
    expect(listed.some((e) => e.name === "demomod")).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("register requires --path", async () => {
  await expect(runPluginCommand(["register", "nodemomod"], flags)).rejects.toThrow(CliError);
});

test("register requires a <name>", async () => {
  await expect(runPluginCommand(["register", "--path", "/tmp/x.ts"], flags)).rejects.toThrow(CliError);
});

test("register accepts --type fact and persists the kind", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rolecall-mod-"));
  const modPath = join(dir, "factmod.ts");
  writeFileSync(modPath, `export default { name: "factmod", run: async () => ({ changed: false }) };\n`);
  try {
    const res = (await runPluginCommand(["register", "factmod", "--path", modPath, "--global", "--type", "fact"], flags)) as PluginRegisterResult;
    expect(res.registered).toBe(true);
    expect(res.type).toBe("fact");
    const listed = listPlugins({ globalRoot: join(rolecallHome, ".rolecall") });
    expect(listed.find((e) => e.name === "factmod")?.type).toBe("fact");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("register rejects an unknown --type", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rolecall-mod-"));
  const modPath = join(dir, "badtype.ts");
  writeFileSync(modPath, `export default { name: "badtype", run: async () => ({ changed: false }) };\n`);
  try {
    await expect(runPluginCommand(["register", "badtype", "--path", modPath, "--global", "--type", "wat"], flags)).rejects.toThrow(CliError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("list merges inventory plugins", async () => {
  const res = (await runPluginCommand(["list"], flags)) as PluginListResult;
  expect(res.command).toBe("plugin list");
  expect(Array.isArray(res.plugins)).toBe(true);
});
