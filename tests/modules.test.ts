// Module SDK tests (Todo 15): dynamic plugin loading + end-to-end executor run.
// Bun-only MVP (bun test). Covers: .ts plugin loads with no build + runs via
// runTask; .js plugin loads; malformed plugin surfaces a readable error; built-in
// modules register and run through a real LocalConnection.

import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { getModule, runTask } from "../src/executor";
import { createConnection } from "../src/transport";
import { loadModuleFromFile, registerAllModules } from "../src/modules";
import type { NormalizedInventory } from "../src/config/schema";

const here = dirname(fileURLToPath(import.meta.url));
const fx = join(here, "fixtures", "plugins");

function inventory(hosts: string[]): NormalizedInventory {
  return { groups: { all: { hosts, vars: {} } } };
}

// (a) .ts plugin loads at runtime with NO pre-build and executes via the executor.
test("(a) .ts plugin loads dynamically (no build) and runs via executor", async () => {
  const mod = await loadModuleFromFile(join(fx, "greeter.ts"));
  expect(mod.name).toBe("greeter");
  expect(getModule("greeter")).toBeDefined();
  const res = await runTask(
    { name: "greet", module: "greeter", args: { who: "rolecall" }, hosts: "h1" },
    inventory(["h1"]),
  );
  expect(res.ok).toBe(1);
  expect(res.failed).toBe(0);
  expect(res.hosts["h1"]![0]!.iterations[0]!.stdout).toContain("hello rolecall");
});

// (b) .js plugin also loads dynamically and runs via the executor.
test("(b) .js plugin loads dynamically and runs via executor", async () => {
  await loadModuleFromFile(join(fx, "echo.js"));
  const res = await runTask(
    { name: "echo", module: "echojs", args: { msg: "hi" }, hosts: "h1" },
    inventory(["h1"]),
  );
  expect(res.ok).toBe(1);
  expect(res.hosts["h1"]![0]!.iterations[0]!.stdout).toBe("hi");
});

// (c) malformed plugin (throws in run) surfaces a readable error; run fails cleanly.
test("(c) plugin that throws in run surfaces a readable error and fails", async () => {
  await loadModuleFromFile(join(fx, "broken.ts"));
  const res = await runTask(
    { name: "boom", module: "broken", args: {}, hosts: "h1" },
    inventory(["h1"]),
  );
  expect(res.failed).toBe(1);
  expect(res.hosts["h1"]![0]!.failed).toBe(true);
  expect(res.hosts["h1"]![0]!.iterations[0]!.msg ?? "").toContain("intentional failure");
});

// (d) built-in example modules register and shell runs end-to-end via LocalConnection.
test("(d) built-in example modules register and shell runs via local connection", async () => {
  registerAllModules();
  expect(getModule("service")).toBeDefined();
  expect(getModule("copy")).toBeDefined();
  expect(getModule("shell")).toBeDefined();

  const conn = (h: string) => createConnection({ kind: "local", host: h, user: "x" });
  const res = await runTask(
    { name: "uname", module: "shell", args: { cmd: "echo from-shell", run_mode: "always" }, hosts: "h1" },
    inventory(["h1"]),
    { connectionFor: conn },
  );
  expect(res.ok).toBe(1);
  expect(res.hosts["h1"]![0]!.iterations[0]!.stdout).toContain("from-shell");
});

// (e) copy module writes idempotently via a real LocalConnection.
test("(e) copy module writes idempotently via local connection", async () => {
  const tmp = join(tmpdir(), `rolecall-file-${randomUUID()}.txt`);
  const conn = (h: string) => createConnection({ kind: "local", host: h, user: "x" });

  const first = await runTask(
    { name: "write", module: "copy", args: { dest: tmp, content: "hello" }, hosts: "h1" },
    inventory(["h1"]),
    { connectionFor: conn },
  );
  expect(first.hosts["h1"]![0]!.changed).toBe(true);

  const second = await runTask(
    { name: "write2", module: "copy", args: { dest: tmp, content: "hello" }, hosts: "h1" },
    inventory(["h1"]),
    { connectionFor: conn },
  );
  expect(second.hosts["h1"]![0]!.changed).toBe(false);

  await conn("h1").exec(`rm -f ${tmp}`);
});
