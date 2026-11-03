import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveInstallLayout } from "../src/install/layout";
import { applyInstallPlan, buildInstallPlan } from "../src/install/plan";
import { applyUpdatePlan, buildUpdatePlan, checkUpdate } from "../src/install/update";
import { runUpdateCommand } from "../src/cli/commands/update";
import type { GlobalFlags } from "../src/cli/types";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "rolecall-update-"));
  dirs.push(d);
  return d;
}
function artifact(root: string, version: string): string {
  const dir = join(root, version);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "rolecall"), `#!/bin/sh\necho rolecall ${version}\n`, { mode: 0o755 });
  writeFileSync(join(dir, "version.txt"), `${version}\n`);
  const digest = createHash("sha256").update(readFileSync(join(dir, "rolecall"))).digest("hex");
  writeFileSync(join(dir, "SHA256SUMS"), `${digest}  rolecall\n`);
  return dir;
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

test("check, update, and rollback switch the current symlink", () => {
  const dir = tmp();
  const l = layout(dir);
  const v1 = artifact(dir, "1.0.0");
  const v2 = artifact(dir, "2.0.0");
  applyInstallPlan(buildInstallPlan({ layout: l, service: false, isolationBackend: "none", fromDir: v1 }), { dryRun: false });
  expect(readlinkSync(join(l.programDir, "current"))).toBe(join("versions", "1.0.0"));

  const check = checkUpdate(l, v2);
  expect(check.currentVersion).toBe("1.0.0");
  expect(check.candidateVersion).toBe("2.0.0");
  expect(check.updateAvailable).toBe(true);

  const update = buildUpdatePlan(l, { fromDir: v2, restart: false });
  applyUpdatePlan(l, update, { dryRun: false, restart: false });
  expect(readlinkSync(join(l.programDir, "current"))).toBe(join("versions", "2.0.0"));
  let manifest = JSON.parse(readFileSync(join(l.configDir, "install.json"), "utf8"));
  expect(manifest.currentVersion).toBe("2.0.0");
  expect(manifest.previousVersion).toBe("1.0.0");

  const rollback = buildUpdatePlan(l, { rollback: true, restart: false });
  applyUpdatePlan(l, rollback, { dryRun: false, restart: false });
  expect(readlinkSync(join(l.programDir, "current"))).toBe(join("versions", "1.0.0"));
  manifest = JSON.parse(readFileSync(join(l.configDir, "install.json"), "utf8"));
  expect(manifest.currentVersion).toBe("1.0.0");
  expect(manifest.previousVersion).toBe("2.0.0");
});

test("update defaults to a dry-run", async () => {
  const dir = tmp();
  const l = layout(dir);
  const v1 = artifact(dir, "1.0.0");
  const v2 = artifact(dir, "2.0.0");
  applyInstallPlan(buildInstallPlan({ layout: l, service: false, isolationBackend: "none", fromDir: v1 }), { dryRun: false });
  const res = await runUpdateCommand(flags({
    user: true,
    fromDir: v2,
    noRestart: true,
    prefix: l.programDir,
    configDir: l.configDir,
    stateDir: l.stateDir,
  }), []);
  if (res.command !== "update") throw new Error("unexpected");
  expect(res.applied).toBe(false);
  expect(readlinkSync(join(l.programDir, "current"))).toBe(join("versions", "1.0.0"));
});

test("update --check is read-only", async () => {
  const dir = tmp();
  const l = layout(dir);
  const v1 = artifact(dir, "1.0.0");
  const v2 = artifact(dir, "2.0.0");
  applyInstallPlan(buildInstallPlan({ layout: l, service: false, isolationBackend: "none", fromDir: v1 }), { dryRun: false });
  const res = await runUpdateCommand(flags({
    user: true,
    check: true,
    fromDir: v2,
    prefix: l.programDir,
    configDir: l.configDir,
    stateDir: l.stateDir,
  }), []);
  if (res.command !== "update") throw new Error("unexpected");
  expect(res.check?.updateAvailable).toBe(true);
  expect(readlinkSync(join(l.programDir, "current"))).toBe(join("versions", "1.0.0"));
});

test("update backs up the state DB and refuses a bad --version smoke check", () => {
  const dir = tmp();
  const l = layout(dir);
  const v1 = artifact(dir, "1.0.0");
  const v2 = artifact(dir, "2.0.0");
  applyInstallPlan(buildInstallPlan({ layout: l, service: false, isolationBackend: "none", fromDir: v1 }), { dryRun: false });
  mkdirSync(l.stateDir, { recursive: true });
  writeFileSync(join(l.stateDir, "state.db"), "sqlite-bytes");

  const badDir = join(dir, "bad");
  mkdirSync(badDir, { recursive: true });
  writeFileSync(join(badDir, "rolecall"), "#!/bin/sh\necho rolecall 9.9.9\n", { mode: 0o755 });
  writeFileSync(join(badDir, "version.txt"), "3.0.0\n");
  const badBytes = readFileSync(join(badDir, "rolecall"));
  writeFileSync(join(badDir, "SHA256SUMS"), `${createHash("sha256").update(badBytes).digest("hex")}  rolecall\n`);

  expect(() => {
    const plan = buildUpdatePlan(l, { fromDir: badDir, restart: false });
    applyUpdatePlan(l, plan, { dryRun: false, restart: false });
  }).toThrow(/unexpected version/);

  const good = buildUpdatePlan(l, { fromDir: v2, restart: false });
  const result = applyUpdatePlan(l, good, { dryRun: false, restart: false });
  expect(result.backup).toBeDefined();
  expect(existsSync(result.backup!)).toBe(true);
});

test("a failed restart rolls the current symlink back", () => {
  const dir = tmp();
  const l = layout(dir);
  const v1 = artifact(dir, "1.0.0");
  const v2 = artifact(dir, "2.0.0");
  applyInstallPlan(buildInstallPlan({ layout: l, service: true, isolationBackend: "none", fromDir: v1 }), { dryRun: false });
  const plan = buildUpdatePlan(l, { fromDir: v2, restart: true });
  const result = applyUpdatePlan(l, plan, {
    dryRun: false,
    restart: true,
    serviceRun: () => ({ status: 1, stderr: "restart failed" }),
  });
  expect(result.rolledBack).toBe(true);
  expect(readlinkSync(join(l.programDir, "current"))).toBe(join("versions", "1.0.0"));
  const manifest = JSON.parse(readFileSync(join(l.configDir, "install.json"), "utf8"));
  expect(manifest.currentVersion).toBe("1.0.0");
});
