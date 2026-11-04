import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveInstallLayout } from "../src/install/layout";
import { migrateLegacyState } from "../src/install/migrate";
import { runInstallCommand } from "../src/cli/commands/install";
import type { GlobalFlags } from "../src/cli/types";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "rolecall-migrate-"));
  dirs.push(d);
  return d;
}
const flags = (over: Partial<GlobalFlags> = {}): GlobalFlags => ({
  force: false,
  check: false,
  diff: false,
  output: "json",
  trace: false,
  profile: false,
  isolation: "none",
  ...over,
});

test("migrates legacy state into the XDG state dir and leaves a note", () => {
  const home = tmp();
  const legacy = join(home, ".rolecall");
  mkdirSync(legacy, { recursive: true });
  writeFileSync(join(legacy, "state.db"), "db");
  writeFileSync(join(legacy, "plugins.json"), "{}");
  const layout = resolveInstallLayout({ scope: "user", platform: "linux", home: home, ignoreLegacy: true });
  const result = migrateLegacyState(layout, { legacyDir: legacy });
  expect(result.applied).toBe(true);
  expect(existsSync(join(layout.stateDir, "state.db"))).toBe(true);
  expect(existsSync(join(layout.stateDir, "plugins.json"))).toBe(true);
  expect(existsSync(join(legacy, "MIGRATED.md"))).toBe(true);
  expect(existsSync(join(legacy, "state.db"))).toBe(false);
});

test("dry-run migration does not move files", () => {
  const home = tmp();
  const legacy = join(home, ".rolecall");
  mkdirSync(legacy, { recursive: true });
  writeFileSync(join(legacy, "state.db"), "db");
  const layout = resolveInstallLayout({ scope: "user", platform: "linux", home: home, ignoreLegacy: true });
  const result = migrateLegacyState(layout, { legacyDir: legacy, dryRun: true });
  expect(result.applied).toBe(false);
  expect(existsSync(join(legacy, "state.db"))).toBe(true);
  expect(existsSync(join(layout.stateDir, "state.db"))).toBe(false);
});

test("install --migrate moves legacy state during apply", async () => {
  const home = tmp();
  const legacy = join(home, ".rolecall");
  mkdirSync(legacy, { recursive: true });
  writeFileSync(join(legacy, "state.db"), "db");
  const stateDir = join(home, "new-state");
  const previous = process.env["ROLECALL_HOME"];
  process.env["ROLECALL_HOME"] = home;
  try {
    const res = await runInstallCommand(flags({
      user: true,
      yes: true,
      migrate: true,
      noService: true,
      prefix: join(home, "lib"),
      configDir: join(home, "config"),
      stateDir,
    }), []);
    if (res.command !== "install") throw new Error("unexpected");
    expect(res.migration?.applied).toBe(true);
    expect(existsSync(join(stateDir, "state.db"))).toBe(true);
  } finally {
    if (previous === undefined) delete process.env["ROLECALL_HOME"];
    else process.env["ROLECALL_HOME"] = previous;
  }
});
