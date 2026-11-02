import { expect, test } from "bun:test";
import { resolveInstallLayout } from "../src/install/layout";
import { buildServicePlan, runServicePlan } from "../src/install/service";
import { runServiceCommand } from "../src/cli/commands/service";
import type { GlobalFlags } from "../src/cli/types";

function layout(scope: "user" | "system", platform = "linux") {
  return resolveInstallLayout({
    scope,
    platform,
    home: "/home/me",
    prefix: "/opt/rolecall",
    configDir: "/etc/rolecall",
    stateDir: "/var/lib/rolecall",
  });
}

const flags = (over: Partial<GlobalFlags> = {}): GlobalFlags => ({
  force: false,
  check: false,
  diff: false,
  output: "json",
  trace: false,
  profile: false,
  isolation: "auto",
  ...over,
});

test("systemd plans scope-specific commands", () => {
  const user = buildServicePlan(layout("user"), "start");
  expect(user.commands).toEqual([{ file: "systemctl", args: ["--user", "start", "rolecall"] }]);
  expect(user.requiresRoot).toBe(false);

  const system = buildServicePlan(layout("system"), "install");
  expect(system.commands[0]).toEqual({ file: "systemctl", args: ["daemon-reload"] });
  expect(system.commands[1]).toEqual({ file: "systemctl", args: ["enable", "--now", "rolecall"] });
  expect(system.requiresRoot).toBe(true);
});

test("launchd and Windows plans use their native tools", () => {
  const mac = buildServicePlan(layout("user", "darwin"), "restart", { uid: 501 });
  expect(mac.commands[0]).toEqual({ file: "launchctl", args: ["kickstart", "-k", "gui/501/com.rolecall.serve"] });
  const win = buildServicePlan(layout("user", "win32"), "start");
  expect(win.commands[0]?.file).toBe("sc.exe");
  expect(win.commands[0]?.args).toContain("RoleCall");
});

test("dry-run does not execute; injected runner stops on failure", () => {
  const plan = buildServicePlan(layout("user"), "start");
  expect(runServicePlan(plan, { dryRun: true }).applied).toBe(false);

  const seen: string[] = [];
  const result = runServicePlan(plan, {
    dryRun: false,
    run: (cmd) => {
      seen.push(`${cmd.file} ${cmd.args.join(" ")}`);
      return { status: seen.length === 1 ? 1 : 0 };
    },
  });
  expect(result.applied).toBe(true);
  expect(seen).toHaveLength(1);
});

test("service command plans by default and status is read-only", async () => {
  const res = await runServiceCommand("start", [], flags({ user: true }));
  if (res.command !== "service") throw new Error("unexpected");
  expect(res.applied).toBe(false);
  expect(res.plan.operation).toBe("start");

  expect(buildServicePlan(layout("user"), "status").readOnly).toBe(true);
});
