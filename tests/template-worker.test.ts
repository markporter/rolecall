// ADR 0025 template worker: hidden protocol + sandboxed Jinja rendering.

import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { probeIsolation } from "../src/isolation";
import { renderTemplateIsolated } from "../src/isolation/template-worker";
import { registerAllModules } from "../src/modules/builtins";
import { runPlaybook } from "../src/executor";
import { render as renderEta } from "../src/templating/fast";
import { createConnection } from "../src/transport";

const cleanup: string[] = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("hidden __render-template speaks JSON over stdin/stdout", () => {
  const res = spawnSync(process.execPath, [resolve("src/cli/index.ts"), "__render-template"], {
    input: JSON.stringify({ engine: "jinja", template: "{{ name | default('x') }}", vars: { name: "rolecall" } }),
    encoding: "utf8",
    timeout: 20_000,
  });
  expect(res.status).toBe(0);
  const body = JSON.parse(res.stdout) as { ok?: boolean; output?: string };
  expect(body.ok).toBe(true);
  expect(body.output).toBe("rolecall");
});

test("renderTemplateIsolated runs Nunjucks in the namespace sandbox", async () => {
  const probe = probeIsolation({ backend: "namespace" });
  if (probe.selected !== "namespace" || !probe.userns) return;
  const out = await renderTemplateIsolated({
    engine: "jinja",
    template: "{% for n in items %}{{ loop.index }}={{ n }};{% endfor %}",
    vars: { items: ["a", "b"] },
    isolation: { backend: "namespace", projectRoot: process.cwd() },
  });
  expect(out).toBe("1=a;2=b;");
}, 30_000);

test("renderTemplateIsolated runs EJS/Eta in the namespace sandbox", async () => {
  const probe = probeIsolation({ backend: "namespace" });
  if (probe.selected !== "namespace" || !probe.userns) return;
  const out = await renderTemplateIsolated({
    engine: "ejs",
    template: "<%= name.toUpperCase() %>:<%= 2 + 2 %>",
    vars: { name: "rolecall" },
    isolation: { backend: "namespace", projectRoot: process.cwd() },
  });
  expect(out).toBe("ROLECALL:4");
}, 30_000);

test("in-process Eta does not expose process.env", () => {
  expect(renderEta("<%= process.env.PATH %>", {})).toBe("");
});

test("copy renders engine:jinja through the worker when isolation is set", async () => {
  const probe = probeIsolation({ backend: "namespace" });
  if (probe.selected !== "namespace" || !probe.userns) return;
  registerAllModules();
  const dir = mkdtempSync(join(tmpdir(), "rolecall-copy-worker-"));
  cleanup.push(dir);
  const dest = join(dir, "rendered.conf");
  const inventory = { groups: { all: { hosts: ["h1"], vars: { port: 8080 } } } };
  const playbook = [
    {
      hosts: ["all"],
      vars: {},
      tasks: [
        {
          name: "render",
          module: "copy",
          args: {
            dest,
            content: { template: "listen {{ port }};", engine: "jinja" },
          },
          notify: [],
        },
      ],
    },
  ];
  const result = await runPlaybook(playbook as never, inventory as never, {
    connectionFor: () => createConnection({ kind: "local", host: "h1", user: "tester" }),
    isolation: { backend: "namespace", projectRoot: process.cwd() },
  });
  expect(result.hosts["h1"]![0]!.failed).toBe(false);
  expect(readFileSync(dest, "utf8")).toBe("listen 8080;");
}, 30_000);

test("copy renders engine:ejs through the worker when isolation is set", async () => {
  const probe = probeIsolation({ backend: "namespace" });
  if (probe.selected !== "namespace" || !probe.userns) return;
  registerAllModules();
  const dir = mkdtempSync(join(tmpdir(), "rolecall-copy-ejs-"));
  cleanup.push(dir);
  const dest = join(dir, "rendered.conf");
  const inventory = { groups: { all: { hosts: ["h1"], vars: { port: 9090 } } } };
  const playbook = [
    {
      hosts: ["all"],
      vars: {},
      tasks: [
        {
          name: "render ejs",
          module: "copy",
          args: {
            dest,
            content: { template: "listen <%= port %>;", engine: "ejs" },
          },
          notify: [],
        },
      ],
    },
  ];
  const result = await runPlaybook(playbook as never, inventory as never, {
    connectionFor: () => createConnection({ kind: "local", host: "h1", user: "tester" }),
    isolation: { backend: "namespace", projectRoot: process.cwd() },
  });
  expect(result.hosts["h1"]![0]!.failed).toBe(false);
  expect(readFileSync(dest, "utf8")).toBe("listen 9090;");
}, 30_000);
