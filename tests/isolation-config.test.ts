import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { approvalFor, loadIsolationConfig, normalizeProjectUri } from "../src/isolation/config";

const dirs: string[] = [];
const previous = process.env["ROLECALL_ISOLATION_CONFIG"];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  if (previous === undefined) delete process.env["ROLECALL_ISOLATION_CONFIG"];
  else process.env["ROLECALL_ISOLATION_CONFIG"] = previous;
});

function projectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rolecall-iso-config-"));
  dirs.push(dir);
  return dir;
}

function writeConfig(dir: string, body: string, mode = 0o600): string {
  const path = join(dir, "isolation.yaml");
  writeFileSync(path, body, { mode });
  process.env["ROLECALL_ISOLATION_CONFIG"] = path;
  return path;
}

test("missing config denies restricted code", () => {
  const dir = projectDir();
  process.env["ROLECALL_ISOLATION_CONFIG"] = join(dir, "missing.yaml");
  const config = loadIsolationConfig();
  expect(approvalFor(config, pathToFileURL(dir).href)).toEqual({
    allowRestrictedCode: false,
    allowRestrictedHelpers: false,
  });
});

test("valid config approves by VFS URI", () => {
  const dir = projectDir();
  const project = pathToFileURL(dir).href;
  writeConfig(dir, `version: 1\nprojects:\n  "${project}":\n    templates:\n      allow_restricted_code: true\n      allow_restricted_helpers: false\n`);
  const config = loadIsolationConfig();
  expect(approvalFor(config, project)).toEqual({
    allowRestrictedCode: true,
    allowRestrictedHelpers: false,
  });
  expect(approvalFor(config, pathToFileURL(join(dir, "other")).href).allowRestrictedCode).toBe(false);
});

test("bare path keys are rejected", () => {
  const dir = projectDir();
  writeConfig(dir, `version: 1\nprojects:\n  /tmp/not-a-uri:\n    templates:\n      allow_restricted_code: true\n`);
  expect(() => loadIsolationConfig()).toThrow(/VFS URI/);
});

test("malformed version and non-boolean approvals fail closed", () => {
  const dir = projectDir();
  writeConfig(dir, "version: 2\nprojects: {}\n");
  expect(() => loadIsolationConfig()).toThrow(/version: 1/);
  writeConfig(dir, `version: 1\nprojects:\n  "file:///tmp/x":\n    templates:\n      allow_restricted_code: "yes"\n`);
  expect(() => loadIsolationConfig()).toThrow(/must be boolean/);
});

test("group/world-writable config is rejected on POSIX", () => {
  if (process.platform === "win32") return;
  const dir = projectDir();
  const path = writeConfig(dir, "version: 1\nprojects: {}\n", 0o666);
  chmodSync(path, 0o666);
  expect(() => loadIsolationConfig()).toThrow(/group\/world writable/);
});

test("normalizeProjectUri canonicalizes file URLs", () => {
  const dir = projectDir();
  expect(normalizeProjectUri(pathToFileURL(dir).href)).toBe(pathToFileURL(dir).href);
  expect(() => normalizeProjectUri("/tmp/bare")).toThrow();
});
