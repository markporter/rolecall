import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveInstallLayout } from "../src/install/layout";
import { applyInstallPlan, buildInstallPlan } from "../src/install/plan";
import { runInstallCommand } from "../src/cli/commands/install";
import type { GlobalFlags } from "../src/cli/types";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "rolecall-install-"));
  dirs.push(d);
  return d;
}
function flags(over: Partial<GlobalFlags> = {}): GlobalFlags {
  return {
    force: false,
    check: false,
    diff: false,
    output: "json",
    trace: false,
    profile: false,
    isolation: "auto",
    ...over,
  };
}

test("builds a user install plan with a service unit", () => {
  const dir = tmp();
  const layout = resolveInstallLayout({
    scope: "user",
    platform: "linux",
    home: dir,
    prefix: join(dir, "lib"),
    configDir: join(dir, "config"),
    stateDir: join(dir, "state"),
  });
  const plan = buildInstallPlan({ layout, service: true, isolationBackend: "none" });
  expect(plan.scope).toBe("user");
  expect(plan.service.manager).toBe("systemd");
  expect(plan.service.unitPath).toBe(join(dir, "config", "systemd", "rolecall.service"));
  expect(plan.service.content).toContain("ExecStart=");
  expect(plan.actions.some((a) => a.kind === "write-file")).toBe(true);
  expect(plan.isolation.selected).toBe("none");
});

test("dry-run writes nothing; apply creates dirs, env, manifest, and unit", () => {
  const dir = tmp();
  const layout = resolveInstallLayout({
    scope: "user",
    platform: "linux",
    home: dir,
    prefix: join(dir, "lib"),
    configDir: join(dir, "config"),
    stateDir: join(dir, "state"),
  });
  const plan = buildInstallPlan({ layout, service: true, isolationBackend: "none" });
  const dry = applyInstallPlan(plan, { dryRun: true });
  expect(dry.applied).toBe(false);
  expect(existsSync(layout.configDir)).toBe(false);

  const applied = applyInstallPlan(plan, { dryRun: false });
  expect(applied.applied).toBe(true);
  expect(existsSync(layout.envFile)).toBe(true);
  expect(existsSync(join(layout.configDir, "install.json"))).toBe(true);
  expect(existsSync(plan.service.unitPath!)).toBe(true);
  if (process.platform !== "win32") {
    expect(statSync(layout.envFile).mode & 0o777).toBe(0o600);
  }
  const manifest = JSON.parse(require("node:fs").readFileSync(join(layout.configDir, "install.json"), "utf8"));
  expect(manifest.scope).toBe("user");
  expect(manifest.service.manager).toBe("systemd");
});

test("install command defaults to a dry-run plan", async () => {
  const dir = tmp();
  const res = await runInstallCommand(flags({
    user: true,
    noService: true,
    prefix: join(dir, "lib"),
    configDir: join(dir, "config"),
    stateDir: join(dir, "state"),
    isolation: "none",
  }), []);
  if (res.command !== "install") throw new Error("unexpected");
  expect(res.applied).toBe(false);
  expect(res.plan.scope).toBe("user");
  expect(existsSync(join(dir, "config"))).toBe(false);
});

test("install --yes applies a user-scope install", async () => {
  const dir = tmp();
  const res = await runInstallCommand(flags({
    user: true,
    yes: true,
    noService: true,
    prefix: join(dir, "lib"),
    configDir: join(dir, "config"),
    stateDir: join(dir, "state"),
    isolation: "none",
  }), []);
  if (res.command !== "install") throw new Error("unexpected");
  expect(res.applied).toBe(true);
  expect(existsSync(join(dir, "config", "install.json"))).toBe(true);
  expect(existsSync(join(dir, "config", "rolecall.env"))).toBe(true);
});

test("system-scope apply requires root", async () => {
  if (typeof process.getuid === "function" && process.getuid() === 0) return;
  await expect(runInstallCommand(flags({
    system: true,
    yes: true,
    noService: true,
    prefix: "/tmp/rolecall-system-test",
    configDir: "/tmp/rolecall-system-test/config",
    stateDir: "/tmp/rolecall-system-test/state",
  }), [])).rejects.toThrow(/requires root/);
});
