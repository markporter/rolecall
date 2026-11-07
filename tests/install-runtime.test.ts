import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveInstallLayout } from "../src/install/layout";
import { applyInstallPlan, buildInstallPlan, readInstallManifest } from "../src/install/plan";
import {
  bunAssetName,
  bunReleaseUrl,
  bunRuntimeBin,
  hasLocalBun,
  installBunRuntime,
  readLocalBunVersion,
  resolveLatestBunVersion,
  runtimeStatus,
} from "../src/install/runtime";
import { runInstallCommand } from "../src/cli/commands/install";
import { runRuntimeCommand } from "../src/cli/commands/runtime";
import type { GlobalFlags } from "../src/cli/types";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "rolecall-runtime-"));
  dirs.push(dir);
  return dir;
}

function flags(over: Partial<GlobalFlags> = {}): GlobalFlags {
  return {
    force: false,
    check: false,
    diff: false,
    output: "json",
    trace: false,
    profile: false,
    isolation: "none",
    ...over,
  };
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

function sha(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function bunArtifact(dir: string, version = "1.2.3"): string {
  const artifact = join(dir, "bun-artifact");
  mkdirSync(artifact, { recursive: true });
  writeFileSync(join(artifact, "bun"), "#!/bin/sh\necho bun\n", { mode: 0o755 });
  writeFileSync(join(artifact, "version.txt"), `${version}\n`);
  writeFileSync(join(artifact, "SHA256SUMS"), `${sha(join(artifact, "bun"))}  bun\n`);
  return artifact;
}

test("installs a local Bun artifact, reports it, and removes it", async () => {
  const dir = tmp();
  const layout = layoutFor(dir);
  const artifact = bunArtifact(dir);
  expect(hasLocalBun(artifact)).toBe(true);
  expect(readLocalBunVersion(artifact)).toBe("1.2.3");

  const installed = await installBunRuntime(layout, { version: "1.2.3", fromDir: artifact, dryRun: false });
  expect(installed.source).toBe("local");
  expect(existsSync(installed.bin)).toBe(true);
  if (process.platform !== "win32") expect(statSync(installed.bin).mode & 0o111).not.toBe(0);

  const status = runtimeStatus(layout);
  expect(status.kind).toBe("external");
  expect(status.version).toBe("1.2.3");

  const res = await runRuntimeCommand("remove", [], flags({
    user: true,
    prefix: join(dir, "lib"),
    configDir: join(dir, "config"),
    stateDir: join(dir, "state"),
    yes: true,
  }));
  if (res.command !== "runtime") throw new Error("unexpected");
  expect(res.applied).toBe(true);
  expect(res.removed).toHaveLength(1);
  expect(runtimeStatus(layout).kind).toBe("embedded");
});

test("runtime install/status/remove use the CLI flags", async () => {
  const dir = tmp();
  const artifact = bunArtifact(dir);
  const base = {
    user: true,
    prefix: join(dir, "lib"),
    configDir: join(dir, "config"),
    stateDir: join(dir, "state"),
  };
  const installed = await runRuntimeCommand("install", [], flags({
    ...base,
    fromDir: artifact,
    bunVersion: "1.2.3",
    yes: true,
  }));
  if (installed.command !== "runtime") throw new Error("unexpected");
  expect(installed.applied).toBe(true);
  expect(installed.version).toBe("1.2.3");

  const status = await runRuntimeCommand("status", [], flags(base));
  if (status.command !== "runtime") throw new Error("unexpected");
  expect(status.status.kind).toBe("external");

  const removed = await runRuntimeCommand("remove", [], flags({ ...base, yes: true }));
  if (removed.command !== "runtime") throw new Error("unexpected");
  expect(removed.removed).toHaveLength(1);
});

test("install --with-bun records the toolchain and installs it", async () => {
  const dir = tmp();
  const layout = layoutFor(dir);
  const artifact = join(dir, "artifact");
  const bunDir = join(artifact, "bun");
  mkdirSync(bunDir, { recursive: true });
  writeFileSync(join(artifact, "rolecall"), "#!/bin/sh\necho rolecall\n", { mode: 0o755 });
  writeFileSync(join(artifact, "version.txt"), "9.9.9\n");
  writeFileSync(join(bunDir, "bun"), "#!/bin/sh\necho bun\n", { mode: 0o755 });
  writeFileSync(join(bunDir, "version.txt"), "1.2.3\n");
  writeFileSync(
    join(artifact, "SHA256SUMS"),
    `${sha(join(artifact, "rolecall"))}  rolecall\n`,
  );

  const res = await runInstallCommand(flags({
    user: true,
    yes: true,
    noService: true,
    prefix: join(dir, "lib"),
    configDir: join(dir, "config"),
    stateDir: join(dir, "state"),
    fromDir: artifact,
    withBun: true,
    bunVersion: "1.2.3",
  }), []);
  if (res.command !== "install") throw new Error("unexpected");
  expect(res.applied).toBe(true);
  expect(res.plan.runtime.kind).toBe("bun");
  expect(existsSync(bunRuntimeBin(layout, "1.2.3"))).toBe(true);
  const manifest = readInstallManifest(layout);
  expect(manifest?.["runtime"]).toBe("1.2.3");
});

test("buildInstallPlan requires a Bun version when --with-bun is set", () => {
  const dir = tmp();
  const layout = layoutFor(dir);
  expect(() => buildInstallPlan({ layout, service: false, isolationBackend: "none", withBun: true })).toThrow(/bun-version/);
  const plan = buildInstallPlan({ layout, service: false, isolationBackend: "none", withBun: true, bunVersion: "1.2.3" });
  expect(plan.runtime.kind).toBe("bun");
  applyInstallPlan(plan, { dryRun: false });
  expect(readInstallManifest(layout)?.["runtime"]).toBe("1.2.3");
});

test("Bun release URLs and latest-version discovery are deterministic", async () => {
  expect(bunAssetName("linux", "x64")).toBe("bun-linux-x64.zip");
  expect(bunAssetName("darwin", "arm64")).toBe("bun-darwin-aarch64.zip");
  expect(bunReleaseUrl("1.2.3", "bun-linux-x64.zip")).toContain("/bun-v1.2.3/bun-linux-x64.zip");
  const version = await resolveLatestBunVersion(async () => new Response(JSON.stringify({ tag_name: "bun-v1.2.3" })));
  expect(version).toBe("1.2.3");
});
