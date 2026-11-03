import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/env";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "rolecall-config-"));
  dirs.push(d);
  return d;
}
function file(dir: string, name: string, body: string): string {
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
}

test("rolecall.env precedence is system < user < project < process", () => {
  const dir = tmp();
  const system = file(dir, "system.env", "ROLECALL_SERVE_PORT=1111\nROLECALL_SERVE_HOST=system\n");
  const user = file(dir, "user.env", "ROLECALL_SERVE_PORT=2222\nROLECALL_DB_BACKEND=postgres\n");
  const project = file(dir, "project.env", "ROLECALL_SERVE_PORT=3333\nROLECALL_DB_BACKEND=sqlite\n");
  const cfg = loadConfig({
    systemEnvFile: system,
    userEnvFile: user,
    projectEnvFile: project,
    env: { ROLECALL_SERVE_PORT: "4444" },
  });
  expect(cfg.serve.port).toBe(4444);
  expect(cfg.serve.host).toBe("system");
  expect(cfg.dbBackend).toBe("sqlite");
});

test("missing files are ignored and process env wins", () => {
  const dir = tmp();
  const cfg = loadConfig({
    systemEnvFile: join(dir, "missing-system.env"),
    userEnvFile: join(dir, "missing-user.env"),
    projectEnvFile: join(dir, "missing-project.env"),
    env: { ROLECALL_SCRATCH: "memory", ROLECALL_RUNTIME: "node" },
  });
  expect(cfg.scratch).toBe("memory");
  expect(cfg.runtime).toBe("node");
});

test("quoted values and comments in rolecall.env are parsed", () => {
  const dir = tmp();
  const user = file(dir, "user.env", '# comment\nexport ROLECALL_SERVE_HOST="0.0.0.0"\nROLECALL_UI_DIST=\'/srv/ui\'\n');
  const cfg = loadConfig({ systemEnvFile: join(dir, "none"), userEnvFile: user, projectEnvFile: join(dir, "none2"), env: {} });
  expect(cfg.serve.host).toBe("0.0.0.0");
  expect(cfg.serve.uiDist).toBe("/srv/ui");
});
