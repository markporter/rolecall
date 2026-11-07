import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runIsolationCommand } from "../src/cli/commands/isolation";
import type { GlobalFlags } from "../src/cli/types";
import {
  loadIsolationConfig,
  mergeEgress,
  mergeMounts,
  policyFor,
  projectUriFromDir,
} from "../src/isolation/config";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "rolecall-isolation-"));
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
    isolation: "auto",
    ...over,
  };
}

function setup(): { dir: string; project: string; configPath: string } {
  const dir = tmp();
  const project = join(dir, "project");
  mkdirSync(project, { recursive: true });
  return { dir, project, configPath: join(dir, "isolation.yaml") };
}

test("allow writes a canonical grant with owner-only permissions", async () => {
  const { project, configPath } = setup();
  const res = await runIsolationCommand("allow", ["/srv/certs"], flags({
    project,
    target: "/mnt/certs",
  }), { configPath });
  if (res.command !== "isolation") throw new Error("unexpected");
  expect(res.changed).toBe(true);
  expect(res.grants).toHaveLength(1);
  expect(res.grants[0]?.target).toBe("/mnt/certs");
  expect(res.grants[0]?.mode).toBe("ro");
  expect(existsSync(configPath)).toBe(true);
  if (process.platform !== "win32") expect(statSync(configPath).mode & 0o777).toBe(0o600);

  const policy = policyFor(loadIsolationConfig(configPath), projectUriFromDir(project));
  expect(policy.grants[0]?.source).toBe("/srv/certs");
});

test("revoke removes the grant", async () => {
  const { project, configPath } = setup();
  await runIsolationCommand("allow", ["/srv/certs"], flags({ project }), { configPath });
  const res = await runIsolationCommand("revoke", ["/srv/certs"], flags({ project }), { configPath });
  if (res.command !== "isolation") throw new Error("unexpected");
  expect(res.changed).toBe(true);
  expect(res.grants).toHaveLength(0);
});

test("allow-egress and revoke-egress manage destinations", async () => {
  const { project, configPath } = setup();
  const added = await runIsolationCommand("allow-egress", ["api.example.com"], flags({
    project,
    port: "443",
    scope: "all",
  }), { configPath });
  if (added.command !== "isolation") throw new Error("unexpected");
  expect(added.egress[0]?.host).toBe("api.example.com");
  expect(added.egress[0]?.ports).toEqual([443]);
  expect(added.egress[0]?.scope).toBe("all");

  const removed = await runIsolationCommand("revoke-egress", ["api.example.com:443"], flags({ project }), { configPath });
  if (removed.command !== "isolation") throw new Error("unexpected");
  expect(removed.changed).toBe(true);
  expect(removed.egress).toHaveLength(0);
});

test("--from-request promotes an advisory project grant", async () => {
  const { project, configPath } = setup();
  mkdirSync(join(project, ".rolecall"), { recursive: true });
  writeFileSync(
    join(project, ".rolecall", "isolation.yaml"),
    "version: 1\ngrants:\n  - source: /srv/shared\n    target: /mnt/shared\n    mode: ro\n",
  );

  const res = await runIsolationCommand("allow", [], flags({ project, fromRequest: true }), { configPath });
  if (res.command !== "isolation") throw new Error("unexpected");
  expect(res.changed).toBe(true);
  expect(res.grants[0]?.source).toBe("/srv/shared");
  expect(res.grants[0]?.target).toBe("/mnt/shared");
});

test("list --explain reports unapproved requests", async () => {
  const { project, configPath } = setup();
  mkdirSync(join(project, ".rolecall"), { recursive: true });
  writeFileSync(
    join(project, ".rolecall", "isolation.yaml"),
    "version: 1\negress:\n  - host: api.example.com\n    ports: [443]\n",
  );

  const res = await runIsolationCommand("list", [], flags({ project, explain: true, egress: true }), { configPath });
  if (res.command !== "isolation") throw new Error("unexpected");
  expect(res.requests?.egress[0]?.host).toBe("api.example.com");
  expect(res.egress).toHaveLength(0);
});

test("denied and socket paths fail closed", async () => {
  const { project, configPath } = setup();
  await expect(runIsolationCommand("allow", ["/"], flags({ project }), { configPath })).rejects.toThrow(/refusing/);
  await expect(runIsolationCommand("allow", ["/tmp/agent.sock"], flags({ project }), { configPath })).rejects.toThrow(/type: socket/);
});

test("merge helpers put one-off grants first and deduplicate", () => {
  const policy = {
    templates: { allowRestrictedCode: false, allowRestrictedHelpers: false },
    grants: [{ source: "/srv/certs", target: "/mnt/certs", mode: "ro" as const, optional: false, type: "dir" as const }],
    egress: [{ host: "api.example.com", ports: [443], protocol: "tcp" as const, scope: "shell" as const }],
  };
  const mounts = mergeMounts([{ source: "/srv/certs", target: "/mnt/certs", mode: "ro" }], policy);
  expect(mounts).toHaveLength(1);
  const egress = mergeEgress([{ host: "api.example.com", ports: [443], protocol: "tcp", scope: "shell" }], policy);
  expect(egress).toHaveLength(1);
});

test("saved config preserves restricted-code approvals", async () => {
  const { project, configPath } = setup();
  writeFileSync(
    configPath,
    `version: 1\nprojects:\n  "${projectUriFromDir(project)}":\n    templates:\n      allow_restricted_code: true\n`,
    { mode: 0o600 },
  );
  const res = await runIsolationCommand("allow", ["/srv/certs"], flags({ project }), { configPath });
  if (res.command !== "isolation") throw new Error("unexpected");
  const saved = readFileSync(configPath, "utf8");
  expect(saved).toContain("allow_restricted_code: true");
});
