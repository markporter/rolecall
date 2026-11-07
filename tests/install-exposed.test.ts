import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveInstallLayout } from "../src/install/layout";
import { applyInstallPlan, buildInstallPlan } from "../src/install/plan";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "rolecall-install-exposed-"));
  dirs.push(dir);
  return dir;
}

function layoutFor(dir: string) {
  return resolveInstallLayout({
    scope: "user",
    platform: "linux",
    home: dir,
    prefix: join(dir, "lib"),
    configDir: join(dir, "config"),
    stateDir: join(dir, "state"),
  });
}

test("install --exposed generates a token, writes it to rolecall.env, and marks the unit", () => {
  const dir = tmp();
  const layout = layoutFor(dir);
  const plan = buildInstallPlan({ layout, service: true, isolationBackend: "none", exposed: true });

  expect(plan.serve.exposed).toBe(true);
  expect(plan.serve.tokenGenerated).toBe(true);
  expect(plan.serve.token).toBeTruthy();
  expect(plan.service.content).toContain("--serve --exposed");

  applyInstallPlan(plan, { dryRun: false });
  const env = readFileSync(layout.envFile, "utf8");
  expect(env).toContain("ROLECALL_SERVE_EXPOSED=1");
  expect(env).toContain("ROLECALL_SERVE_HOST=127.0.0.1");
  expect(env).toContain(`ROLECALL_SERVE_TOKEN=${plan.serve.token}`);
});

test("a second exposed plan reuses the stored token without echoing it", () => {
  const dir = tmp();
  const layout = layoutFor(dir);
  const first = buildInstallPlan({ layout, service: true, isolationBackend: "none", exposed: true });
  applyInstallPlan(first, { dryRun: false });

  const second = buildInstallPlan({ layout, service: true, isolationBackend: "none", exposed: true });
  expect(second.serve.tokenGenerated).toBe(false);
  expect(second.serve.token).toBeUndefined();
  applyInstallPlan(second, { dryRun: false });

  const env = readFileSync(layout.envFile, "utf8");
  expect(env).toContain(`ROLECALL_SERVE_TOKEN=${first.serve.token}`);
});

test("a system service install provisions a token even without --exposed", () => {
  const dir = tmp();
  const layout = resolveInstallLayout({
    scope: "system",
    platform: "linux",
    home: "/root",
    prefix: join(dir, "lib"),
    configDir: join(dir, "config"),
    stateDir: join(dir, "state"),
  });
  const plan = buildInstallPlan({ layout, service: true, isolationBackend: "none" });
  expect(plan.serve.exposed).toBe(false);
  expect(plan.serve.tokenGenerated).toBe(true);
  expect(plan.serve.token).toBeTruthy();
});

test("--force does not drop an existing token when the plan reuses it", () => {
  const dir = tmp();
  const layout = layoutFor(dir);
  const first = buildInstallPlan({ layout, service: true, isolationBackend: "none", exposed: true });
  applyInstallPlan(first, { dryRun: false });

  const second = buildInstallPlan({ layout, service: true, isolationBackend: "none", exposed: true });
  applyInstallPlan(second, { dryRun: false, force: true });

  const env = readFileSync(layout.envFile, "utf8");
  expect(env).toContain(`ROLECALL_SERVE_TOKEN=${first.serve.token}`);
});

test("an explicit serveToken is written as given", () => {
  const dir = tmp();
  const layout = layoutFor(dir);
  const plan = buildInstallPlan({
    layout,
    service: false,
    isolationBackend: "none",
    exposed: true,
    serveToken: "explicit-token",
    serveHost: "0.0.0.0",
  });
  expect(plan.serve.tokenGenerated).toBe(false);
  applyInstallPlan(plan, { dryRun: false });
  const env = readFileSync(layout.envFile, "utf8");
  expect(env).toContain("ROLECALL_SERVE_TOKEN=explicit-token");
  expect(env).toContain("ROLECALL_SERVE_HOST=0.0.0.0");
});
