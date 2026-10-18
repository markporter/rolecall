// Env config layer tests — loadConfig() merges ROLECALL_* env vars over safe
// defaults; unset variables leave behavior identical to the prior ad-hoc reads.
// Bun-native bun:test. process.env keys are snapshotted/restored around each
// test so nothing leaks into sibling suites or the default assertions below.
import { afterEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";

import { loadConfig } from "./env";

const MANAGED_KEYS = [
  "ROLECALL_DB_BACKEND",
  "ROLECALL_DB_URL",
  "ROLECALL_PROJECT_GIT_URL",
  "ROLECALL_SCRATCH",
  "ROLECALL_SCRATCH_DIR",
  "ROLECALL_SERVE_PORT",
  "ROLECALL_SERVE_HOST",
  "ROLECALL_UI_DIST",
  "ROLECALL_SERVE_UI_DIST",
  "ROLECALL_HOME",
  "ROLECALL_PROJECT_STATE",
  "ROLECALL_RUNTIME",
] as const;

const savedEnv: Record<string, string | undefined> = {};
for (const key of MANAGED_KEYS) savedEnv[key] = process.env[key];

afterEach(() => {
  for (const key of MANAGED_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

/** Ensure a managed key starts cleared before an individual assertion mutates it. */
function clearManaged(): void {
  for (const key of MANAGED_KEYS) delete process.env[key];
}

describe("loadConfig — defaults when vars unset", () => {
  test("DB backend, scratch strategy, and scratch dir fall back to safe values", () => {
    clearManaged();
    const cfg = loadConfig();
    expect(cfg.dbBackend).toBe("sqlite");
    expect(cfg.scratch).toBe("fs");
    expect(cfg.scratchDir).toBe(tmpdir());
  });

  test("serve fields stay undefined so callers apply their own numeric/host defaults", () => {
    clearManaged();
    const cfg = loadConfig();
    expect(cfg.serve.port).toBeUndefined();
    expect(cfg.serve.host).toBeUndefined();
    expect(cfg.serve.uiDist).toBeUndefined();
  });

  test("optional URL / home / state passthroughs are undefined when unset", () => {
    clearManaged();
    const cfg = loadConfig();
    expect(cfg.dbUrl).toBeUndefined();
    expect(cfg.projectGitUrl).toBeUndefined();
    expect(cfg.home).toBeUndefined();
    expect(cfg.projectState).toBeUndefined();
    expect(cfg.runtime).toBeUndefined();
  });
});

describe("loadConfig — reflects set vars", () => {
  test("dbBackend follows ROLECALL_DB_BACKEND (postgres accepted, sqlite explicit)", () => {
    clearManaged();
    process.env.ROLECALL_DB_BACKEND = "postgres";
    expect(loadConfig().dbBackend).toBe("postgres");
    process.env.ROLECALL_DB_BACKEND = "sqlite";
    expect(loadConfig().dbBackend).toBe("sqlite");
  });

  test("unknown db backend normalizes to sqlite rather than leaking an invalid value", () => {
    clearManaged();
    process.env.ROLECALL_DB_BACKEND = "mysql";
    expect(loadConfig().dbBackend).toBe("sqlite");
  });

  test("scratch follows ROLECALL_SCRATCH (memory vs fs)", () => {
    clearManaged();
    process.env.ROLECALL_SCRATCH = "memory";
    expect(loadConfig().scratch).toBe("memory");
    process.env.ROLECALL_SCRATCH = "fs";
    expect(loadConfig().scratch).toBe("fs");
  });

  test("scratchDir follows ROLECALL_SCRATCH_DIR", () => {
    clearManaged();
    process.env.ROLECALL_SCRATCH_DIR = "/tmp/rolecall-custom-scratch";
    expect(loadConfig().scratchDir).toBe("/tmp/rolecall-custom-scratch");
  });

  test("serve port parses to a number and host/ui-dist pass through", () => {
    clearManaged();
    process.env.ROLECALL_SERVE_PORT = "9090";
    process.env.ROLECALL_SERVE_HOST = "0.0.0.0";
    process.env.ROLECALL_UI_DIST = "/srv/ui";
    const cfg = loadConfig();
    expect(cfg.serve.port).toBe(9090);
    expect(cfg.serve.host).toBe("0.0.0.0");
    expect(cfg.serve.uiDist).toBe("/srv/ui");
  });

  test("legacy ROLECALL_SERVE_UI_DIST is honored only as a fallback behind ROLECALL_UI_DIST", () => {
    clearManaged();
    process.env.ROLECALL_SERVE_UI_DIST = "/legacy";
    expect(loadConfig().serve.uiDist).toBe("/legacy");

    process.env.ROLECALL_UI_DIST = "/modern";
    expect(loadConfig().serve.uiDist).toBe("/modern");
  });

  test("URL, home, project-state, and runtime env vars pass through unchanged", () => {
    clearManaged();
    process.env.ROLECALL_DB_URL = "postgresql://localhost/rolecall";
    process.env.ROLECALL_PROJECT_GIT_URL = "git@example.com:rolecall/proj.git";
    process.env.ROLECALL_HOME = "/opt/rolecall-home";
    process.env.ROLECALL_PROJECT_STATE = "/var/lib/rolecall/state";
    process.env.ROLECALL_RUNTIME = "node";
    const cfg = loadConfig();
    expect(cfg.dbUrl).toBe("postgresql://localhost/rolecall");
    expect(cfg.projectGitUrl).toBe("git@example.com:rolecall/proj.git");
    expect(cfg.home).toBe("/opt/rolecall-home");
    expect(cfg.projectState).toBe("/var/lib/rolecall/state");
    expect(cfg.runtime).toBe("node");
  });

  test("empty-string dbUrl / projectGitUrl normalize to undefined", () => {
    clearManaged();
    process.env.ROLECALL_DB_URL = "";
    process.env.ROLECALL_PROJECT_GIT_URL = "";
    const cfg = loadConfig();
    expect(cfg.dbUrl).toBeUndefined();
    expect(cfg.projectGitUrl).toBeUndefined();
  });
});

describe("loadConfig — empty ROLECALL_SCRATCH_DIR falls back without throwing", () => {
  test("empty string resolves to os.tmpdir() and does not throw", () => {
    clearManaged();
    process.env.ROLECALL_SCRATCH_DIR = "";
    let didThrow = false;
    let resolved: string | undefined;
    try {
      resolved = loadConfig().scratchDir;
    } catch {
      didThrow = true;
    }
    expect(didThrow).toBe(false);
    expect(resolved).toBe(tmpdir());
  });

  test("whitespace-free but non-empty scratch dir is preserved alongside the fallback", () => {
    clearManaged();
    process.env.ROLECALL_SCRATCH = "fs";
    process.env.ROLECALL_SCRATCH_DIR = "/var/rolecall/scratch";
    const cfg = loadConfig();
    expect(cfg.scratch).toBe("fs");
    expect(cfg.scratchDir).toBe("/var/rolecall/scratch");
  });
});
