import { expect, test } from "bun:test";
import { detectInstallKind, packageManagerUpdateCommand } from "../src/install/kind";
import { resolveInstallLayout } from "../src/install/layout";
import { buildInstallPlan, applyInstallPlan } from "../src/install/plan";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("detectInstallKind uses manifest then argv shape", () => {
  expect(detectInstallKind("npm", "/whatever")).toBe("npm");
  expect(detectInstallKind(undefined, "/home/me/app/node_modules/@rolecall/cli/lib/cli.js")).toBe("npm");
  expect(detectInstallKind(undefined, "/home/me/.bun/install/global/node_modules/@rolecall/cli/lib/cli.js")).toBe("bun-global");
  expect(detectInstallKind(undefined, "/home/me/rolecall/src/cli/index.ts")).toBe("source");
  expect(detectInstallKind(undefined, "/usr/local/bin/rolecall")).toBe("binary");
});

test("package-manager update commands", () => {
  expect(packageManagerUpdateCommand("npm", "1.2.3")).toEqual({
    file: "npm",
    args: ["i", "-g", "@rolecall/cli@1.2.3"],
  });
  expect(packageManagerUpdateCommand("bun-global", "1.2.3")).toEqual({
    file: "bun",
    args: ["add", "-g", "@rolecall/cli@1.2.3"],
  });
  expect(packageManagerUpdateCommand("binary", "1.2.3")).toBeUndefined();
});

test("install manifests record kind: binary", () => {
  const dir = mkdtempSync(join(tmpdir(), "rolecall-kind-"));
  try {
    const layout = resolveInstallLayout({
      scope: "user",
      platform: "linux",
      home: dir,
      prefix: join(dir, "lib"),
      configDir: join(dir, "config"),
      stateDir: join(dir, "state"),
    });
    const plan = buildInstallPlan({ layout, service: false, isolationBackend: "none" });
    expect(plan.kind).toBe("binary");
    applyInstallPlan(plan, { dryRun: false });
    const manifest = JSON.parse(readFileSync(join(layout.configDir, "install.json"), "utf8"));
    expect(manifest.kind).toBe("binary");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
