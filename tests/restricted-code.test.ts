// ADR 0025 restricted-code approval enforcement ($template / $call / Eta / EJS).

import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runPlaybook } from "../src/executor";
import { createConnection } from "../src/transport";
import { registerAllModules } from "../src/modules/builtins";
import { registerHelper } from "../src/templating/refs";
import { spawnSync } from "node:child_process";

registerAllModules();
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "rolecall-restricted-"));
  dirs.push(dir);
  return dir;
}

const inventory = { groups: { all: { hosts: ["h1"], vars: { port: 8080 } } } };
const playbook = (tasks: unknown[]) => [{ hosts: ["all"], vars: {}, tasks }];
const local = () => createConnection({ kind: "local", host: "h1", user: "tester" });

test("$template is denied unless allow_restricted_code is true", async () => {
  const pb = playbook([{ name: "t", module: "debug", args: { msg: { $template: "<%= port %>" } }, notify: [] }]);
  const denied = await runPlaybook(pb as never, inventory as never, {
    connectionFor: local,
    approvals: { allowRestrictedCode: false, allowRestrictedHelpers: false },
  });
  expect(denied.hosts["h1"]![0]!.failed).toBe(true);

  const allowed = await runPlaybook(pb as never, inventory as never, {
    connectionFor: local,
    approvals: { allowRestrictedCode: true, allowRestrictedHelpers: false, allowUnsafeTemplateCode: true },
  });
  expect(allowed.hosts["h1"]![0]!.failed).toBe(false);
});

test("$call is denied unless allow_restricted_helpers is true", async () => {
  registerHelper("__restricted_helper", () => "ok");
  const pb = playbook([{ name: "t", module: "debug", args: { msg: { $call: "__restricted_helper" } }, notify: [] }]);
  const denied = await runPlaybook(pb as never, inventory as never, {
    connectionFor: local,
    approvals: { allowRestrictedCode: true, allowRestrictedHelpers: false },
  });
  expect(denied.hosts["h1"]![0]!.failed).toBe(true);

  const allowed = await runPlaybook(pb as never, inventory as never, {
    connectionFor: local,
    approvals: { allowRestrictedCode: true, allowRestrictedHelpers: true, allowUnsafeTemplateCode: true },
  });
  expect(allowed.hosts["h1"]![0]!.failed).toBe(false);
});

test("Eta copy is denied without approval and also requires the unsafe override in-process", async () => {
  const dir = tmp();
  const dest = join(dir, "out.conf");
  const pb = playbook([
    { name: "t", module: "copy", args: { dest, content: { template: "port=<%= port %>", engine: "ejs" } }, notify: [] },
  ]);

  const denied = await runPlaybook(pb as never, inventory as never, {
    connectionFor: local,
    approvals: { allowRestrictedCode: false, allowRestrictedHelpers: false },
  });
  expect(denied.hosts["h1"]![0]!.failed).toBe(true);

  const unsafeDenied = await runPlaybook(pb as never, inventory as never, {
    connectionFor: local,
    isolation: { backend: "none" },
    approvals: { allowRestrictedCode: true, allowRestrictedHelpers: false },
  });
  expect(unsafeDenied.hosts["h1"]![0]!.failed).toBe(true);

  const unsafeAllowed = await runPlaybook(pb as never, inventory as never, {
    connectionFor: local,
    isolation: { backend: "none" },
    allowUnsafeTemplateCode: true,
    approvals: {
      allowRestrictedCode: true,
      allowRestrictedHelpers: false,
      allowUnsafeTemplateCode: true,
    },
  });
  expect(unsafeAllowed.hosts["h1"]![0]!.failed).toBe(false);
  expect(readFileSync(dest, "utf8")).toBe("port=8080");
});

test("CLI loads isolation.yaml approvals by project VFS URI", () => {
  const dir = tmp();
  const dest = join(dir, "out.conf");
  const playbookPath = join(dir, "site.yaml");
  const inventoryPath = join(dir, "inv.yaml");
  writeFileSync(playbookPath, [
    "- hosts: all",
    "  tasks:",
    "    - name: render",
    "      module: copy",
    "      args:",
    `        dest: ${dest}`,
    "        content:",
    "          template: \"port=<%= port %>\"",
    "          engine: ejs",
  ].join("\n"));
  writeFileSync(inventoryPath, [
    "groups:",
    "  all:",
    "    hosts: [h1]",
    "    vars:",
    "      port: 8080",
    "      rolecall_connection: local",
  ].join("\n"));
  const configPath = join(dir, "isolation.yaml");
  const projectUri = pathToFileURL(dir).href;
  writeFileSync(configPath, [
    "version: 1",
    "projects:",
    `  "${projectUri}":`,
    "    templates:",
    "      allow_restricted_code: true",
    "      allow_restricted_helpers: false",
  ].join("\n"), { mode: 0o600 });

  const res = spawnSync(process.execPath, [
    resolve("src/cli/index.ts"),
    "playbook",
    "run",
    playbookPath,
    "--inventory",
    inventoryPath,
    "--isolation",
    "none",
    "--allow-unsafe-template-code",
    "-o",
    "json",
  ], {
    cwd: resolve("."),
    env: {
      ...process.env,
      ROLECALL_ISOLATION: "none",
      ROLECALL_ISOLATION_CONFIG: configPath,
    },
    encoding: "utf8",
    timeout: 30_000,
  });
  expect(res.status).toBe(0);
  const body = JSON.parse(res.stdout) as { totals?: { failed?: number } };
  expect(body.totals?.failed).toBe(0);
  expect(readFileSync(dest, "utf8")).toBe("port=8080");
}, 40_000);
