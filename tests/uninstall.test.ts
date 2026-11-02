import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveInstallLayout } from "../src/install/layout";
import { applyInstallPlan, buildInstallPlan } from "../src/install/plan";
import { applyUninstallPlan, buildUninstallPlan } from "../src/install/uninstall";
import { runUninstallCommand } from "../src/cli/commands/uninstall";
import type { GlobalFlags } from "../src/cli/types";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "rolecall-uninstall-"));
  dirs.push(d);
  return d;
}
function layout(dir: string) {
  return resolveInstallLayout({
    scope: "user",
    platform: "linux",
    home: dir,
    prefix: join(dir, "lib"),
    configDir: join(dir, "config"),
    stateDir: join(dir, "state"),
  });
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

test("uninstall keeps config/state by default and removes manifest/unit", () => {
  const dir = tmp();
  const l = layout(dir);
  const install = buildInstallPlan({ layout: l, service: true, isolationBackend: "none" });
  applyInstallPlan(install, { dryRun: false });

  const plan = buildUninstallPlan(l);
  const serviceCalls: string[] = [];
  const result = applyUninstallPlan(plan, {
    dryRun: false,
    serviceRun: (cmd) => {
      serviceCalls.push(`${cmd.file} ${cmd.args.join(" ")}`);
      return { status: 0 };
    },
  });
  expect(result.applied).toBe(true);
  expect(serviceCalls.length).toBeGreaterThan(0);
  expect(existsSync(join(l.configDir, "install.json"))).toBe(false);
  expect(existsSync(install.service.unitPath!)).toBe(false);
  expect(existsSync(l.envFile)).toBe(true);
  expect(existsSync(l.stateDir)).toBe(true);
});

test("uninstall --purge removes config/state/cache", () => {
  const dir = tmp();
  const l = layout(dir);
  applyInstallPlan(buildInstallPlan({ layout: l, service: false, isolationBackend: "none" }), { dryRun: false });
  const plan = buildUninstallPlan(l, { purge: true });
  applyUninstallPlan(plan, { dryRun: false, serviceRun: () => ({ status: 0 }) });
  expect(existsSync(l.configDir)).toBe(false);
  expect(existsSync(l.stateDir)).toBe(false);
  expect(existsSync(l.cacheDir)).toBe(false);
});

test("uninstall command defaults to a dry-run", async () => {
  const dir = tmp();
  const l = layout(dir);
  applyInstallPlan(buildInstallPlan({ layout: l, service: false, isolationBackend: "none" }), { dryRun: false });
  const res = await runUninstallCommand(flags({
    user: true,
    prefix: l.programDir,
    configDir: l.configDir,
    stateDir: l.stateDir,
  }), []);
  if (res.command !== "uninstall") throw new Error("unexpected");
  expect(res.applied).toBe(false);
  expect(existsSync(join(l.configDir, "install.json"))).toBe(true);
});
