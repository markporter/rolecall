import { expect, test } from "bun:test";
import { join } from "node:path";
import { resolveInstallLayout } from "../src/install/layout";
import { parseEnvFile } from "../src/install/env-file";
import { runDoctorCommand } from "../src/cli/commands/doctor";
import type { GlobalFlags } from "../src/cli/types";
import type { ProbeDeps } from "../src/isolation";

const env = {};

test("linux user layout uses XDG paths and ~/.local/bin", () => {
  const l = resolveInstallLayout({
    platform: "linux",
    scope: "user",
    home: "/home/me",
    env: { XDG_CONFIG_HOME: "/cfg", XDG_STATE_HOME: "/state", XDG_CACHE_HOME: "/cache" },
  });
  expect(l.programDir).toBe("/home/me/.local/lib/rolecall");
  expect(l.configDir).toBe("/cfg/rolecall");
  expect(l.stateDir).toBe("/state/rolecall");
  expect(l.cacheDir).toBe("/cache/rolecall");
  expect(l.binDir).toBe("/home/me/.local/bin");
  expect(l.envFile).toBe("/cfg/rolecall/rolecall.env");
});

test("linux system layout uses the ADR paths", () => {
  const l = resolveInstallLayout({ platform: "linux", scope: "system", home: "/root", env });
  expect(l.programDir).toBe("/opt/rolecall");
  expect(l.configDir).toBe("/etc/rolecall");
  expect(l.stateDir).toBe("/var/lib/rolecall");
  expect(l.cacheDir).toBe("/var/cache/rolecall");
  expect(l.binDir).toBe("/usr/local/bin");
});

test("macOS and Windows scopes map to their platform directories", () => {
  const mac = resolveInstallLayout({ platform: "darwin", scope: "user", home: "/Users/me", env });
  expect(mac.programDir).toBe("/Users/me/Library/Application Support/RoleCall/lib");
  expect(mac.stateDir).toBe("/Users/me/Library/Application Support/RoleCall/state");
  expect(mac.binDir).toBe("/Users/me/.local/bin");

  const win = resolveInstallLayout({
    platform: "win32",
    scope: "user",
    home: "C:\\Users\\me",
    env: { APPDATA: "C:\\Users\\me\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
  });
  expect(win.programDir).toContain("Programs");
  expect(win.configDir).toContain("Roaming");
  expect(win.stateDir).toContain("state");
});

test("legacy ~/.rolecall is honored when the XDG state path is absent", () => {
  const l = resolveInstallLayout({
    platform: "linux",
    scope: "user",
    home: "/home/me",
    env: {},
    exists: (p) => p === "/home/me/.rolecall",
  });
  expect(l.stateDir).toBe("/home/me/.rolecall");
});

test("explicit overrides win over platform defaults", () => {
  const l = resolveInstallLayout({
    platform: "linux",
    scope: "system",
    home: "/root",
    env: {},
    prefix: "/srv/rolecall",
    configDir: "/srv/etc",
    stateDir: "/srv/state",
  });
  expect(l.programDir).toBe("/srv/rolecall");
  expect(l.binDir).toBe("/srv/rolecall/bin");
  expect(l.configDir).toBe("/srv/etc");
  expect(l.stateDir).toBe("/srv/state");
});

test("parseEnvFile handles comments, export, quotes, and malformed lines", () => {
  expect(
    parseEnvFile(`
# comment
ROLECALL_SERVE_PORT=9090
export ROLECALL_SERVE_HOST="0.0.0.0"
QUOTED='value with spaces'
BAD LINE
EMPTY=
`),
  ).toEqual({
    ROLECALL_SERVE_PORT: "9090",
    ROLECALL_SERVE_HOST: "0.0.0.0",
    QUOTED: "value with spaces",
    EMPTY: "",
  });
});

test("doctor reports the resolved install layout", async () => {
  const flags: GlobalFlags = {
    force: false,
    check: false,
    diff: false,
    output: "human_summary",
    trace: false,
    profile: false,
  };
  const deps: Partial<ProbeDeps> = {
    platform: "linux",
    which: () => false,
    run: () => ({ status: 1 }),
    env: {},
  };
  const res = await runDoctorCommand(flags, [], { probeDeps: deps });
  if (res.command !== "doctor") throw new Error("unexpected");
  expect(["user", "system"]).toContain(res.install.scope);
  expect(res.install.envFile.endsWith("rolecall.env")).toBe(true);
  expect(res.install.programDir.length).toBeGreaterThan(0);
  expect(join(res.install.configDir, "rolecall.env")).toBe(res.install.envFile);
});
