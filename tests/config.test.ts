// Config loader tests — schema validation, normalization, strict rejection,
// Zod field-path naming, and round-trip stability. Bun-only MVP (bun test).
import { expect, test } from "bun:test";
import { deepEqual } from "node:assert";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ZodError } from "zod";

import {
  lintTemplateRefs,
  loadInventory,
  loadInventoryFile,
  loadPlaybook,
  loadPlaybookFile,
} from "../src/config/loader";
import { FsProjectSource } from "../src/vfs/fs-project-source";
import {
  normalizePlaybook,
  serializeInventory,
  serializePlaybook,
  type NormalizedPlaybook,
} from "../src/config/schema";
import {
  evalWhen,
  expandLoop,
  renderArgs,
  type TemplateVars,
} from "../src/executor/context";

const fixtures = join(fileURLToPath(import.meta.url), "..", "fixtures");

// --- Valid playbook: load + normalize --------------------------------------
test("loadPlaybook normalizes a list-form playbook", () => {
  const pb = loadPlaybook(`
- name: demo
  hosts: web
  vars:
    port: 80
  tasks:
    - name: install
      module: apt
      args: { name: nginx }
      notify: restart nginx
`);
  expect(Array.isArray(pb)).toBe(true);
  expect(pb).toHaveLength(1);
  expect(pb[0]?.name).toBe("demo");
  // hosts string -> array
  expect(pb[0]?.hosts).toEqual(["web"]);
  // vars defaulted / present
  expect(pb[0]?.vars).toEqual({ port: 80 });
  // notify string -> array
  expect(pb[0]?.tasks[0]?.notify).toEqual(["restart nginx"]);
  // args preserved
  expect(pb[0]?.tasks[0]?.args).toEqual({ name: "nginx" });
});

test("loadPlaybook rejects a bare-object playbook with a list-required error", () => {
  let err: unknown;
  try {
    loadPlaybook(`
name: demo
hosts: web
tasks:
  - name: install
    module: apt
    args: { name: nginx }
`);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(ZodError);
  const msg = String((err as Error).message);
  expect(msg).toContain("playbook must be a list of plays");
  expect(msg).toContain("wrap the play in a top-level list");
});

test("loadPlaybook accepts hosts as a list", () => {
  const pb = loadPlaybook(`
- hosts: [a, b]
  tasks:
    - name: t
      module: ping
      args: {}
`);
  expect(pb[0]?.hosts).toEqual(["a", "b"]);
});

test("loadPlaybook parses a cron trigger", () => {
  const pb = loadPlaybook(`
- hosts: all
  tasks: [{ name: t, module: ping, args: {} }]
  trigger:
    type: cron
    spec: "0 2 * * *"
`);
  expect(pb[0]?.trigger).toEqual({ type: "cron", spec: "0 2 * * *" });
});

test("loadPlaybook accepts a top-level list of plays", () => {
  const pb = loadPlaybook(`
- name: play one
  hosts: web
  tasks:
    - name: t1
      module: ping
      args: {}
- name: play two
  hosts: db
  tasks:
    - name: t2
      module: ping
      args: {}
`);
  expect(Array.isArray(pb)).toBe(true);
  expect(pb).toHaveLength(2);
  expect(pb[0]?.name).toBe("play one");
  expect(pb[0]?.hosts).toEqual(["web"]);
  expect(pb[1]?.name).toBe("play two");
  expect(pb[1]?.hosts).toEqual(["db"]);
});

test("normalizePlaybook maps a one-play list to a one-element array", () => {
  const raw = [
    {
      hosts: "web",
      tasks: [{ name: "t", module: "ping", args: {} }],
    },
  ];
  const out = normalizePlaybook(raw as never);
  expect(Array.isArray(out)).toBe(true);
  expect(out).toHaveLength(1);
  expect(out[0]?.hosts).toEqual(["web"]);
});

test("normalizePlaybook returns an array of plays for a top-level list", () => {
  const raw = [
    { hosts: "web", tasks: [{ name: "t1", module: "ping", args: {} }] },
    { hosts: "db", tasks: [{ name: "t2", module: "ping", args: {} }] },
  ];
  const out = normalizePlaybook(raw as never);
  expect(out).toHaveLength(2);
  expect(out[0]?.hosts).toEqual(["web"]);
  expect(out[1]?.hosts).toEqual(["db"]);
});

// --- Valid inventory -------------------------------------------------------
test("loadInventory normalizes groups and defaults vars", () => {
  const inv = loadInventory(`
groups:
  web:
    hosts: [w1, w2]
  db:
    hosts: [d1]
    vars: { role: db }
`);
  expect(inv.groups.web?.hosts).toEqual(["w1", "w2"]);
  expect(inv.groups.web?.vars).toEqual({});
  expect(inv.groups.db?.vars).toEqual({ role: "db" });
});

test("loadInventory preserves children and host_vars", () => {
  const inv = loadInventory(`
groups:
  web:
    hosts: [web1]
    vars: { role: web }
    children: [web_edge]
  web_edge:
    hosts: [edge1]
host_vars:
  web1:
    http_port: 80
`);
  expect(inv.groups.web?.children).toEqual(["web_edge"]);
  expect(inv.hostVars).toEqual({ web1: { http_port: 80 } });
});

test("inventory schema rejects a children cycle naming the path", () => {
  let err: unknown;
  try {
    loadInventory(`
groups:
  a:
    hosts: []
    children: [b]
  b:
    hosts: []
    children: [a]
`);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(ZodError);
  expect(String((err as Error).message)).toContain("cycle detected");
});

test("inventory schema rejects a children entry naming an undefined group", () => {
  let err: unknown;
  try {
    loadInventory(`
groups:
  web:
    hosts: []
    children: [missing]
`);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(ZodError);
  const msg = String((err as Error).message);
  expect(msg).toContain("missing");
  expect(msg).toContain("not defined");
});

// --- File loaders ----------------------------------------------------------
test("loadPlaybookFile loads a valid fixture", async () => {
  const pb = await loadPlaybookFile(
    join(fixtures, "playbook.valid.yaml"),
  );
  expect(pb).toHaveLength(1);
  expect(pb[0]?.name).toBe("Configure web servers");
  expect(pb[0]?.hosts).toEqual(["web"]);
  expect(pb[0]?.tasks.length).toBe(3);
  expect(pb[0]?.tasks[1]?.notify).toEqual(["restart nginx"]);
  expect(pb[0]?.trigger).toEqual({ type: "cron", spec: "0 2 * * *" });
});

test("loadInventoryFile loads a valid fixture", async () => {
  const inv = await loadInventoryFile(
    join(fixtures, "inventory.valid.yaml"),
  );
  expect(Object.keys(inv.groups).sort()).toEqual(["db", "web"]);
  expect(inv.groups.web?.hosts).toEqual([
    "web1.example.com",
    "web2.example.com",
  ]);
});

// --- Malformed: Zod error names the field path -----------------------------
test("missing tasks throws ZodError naming path 'tasks'", async () => {
  let err: unknown;
  try {
    await loadPlaybookFile(
      join(fixtures, "playbook.malformed.missing-tasks.yaml"),
    );
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(ZodError);
  // The missing `tasks` key is reported on the list element (path ["tasks"]).
  expect(String((err as Error).message)).toContain("tasks");
});

test("unknown key (idempotent) is rejected — architecture constraint", async () => {
  let err: unknown;
  try {
    await loadPlaybookFile(
      join(fixtures, "playbook.malformed.unknown-key.yaml"),
    );
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(ZodError);
  const issues = err as ZodError;
  // strict() rejects the unknown `idempotent` key on the task (path play 0,
  // tasks.0); the list index prefixes the path.
  const rejectedIdempotent = issues.issues.some(
    (i) =>
      i.code === "unrecognized_keys" &&
      i.path.join(".").endsWith("tasks.0") &&
      i.keys.includes("idempotent"),
  );
  expect(rejectedIdempotent).toBe(true);
});

test("strict schema rejects unknown keys even when import/include fields are present", () => {
  let err: unknown;
  try {
    loadPlaybook(`
- hosts: web
  imports: [other.yaml]
  tasks:
    - name: t
      module: shell
      args: { command: "echo x" }
      bogus_field: true
`);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(ZodError);
  const issues = err as ZodError;
  const rejected = issues.issues.some(
    (i) => i.code === "unrecognized_keys" && i.keys.includes("bogus_field"),
  );
  expect(rejected).toBe(true);
});

test("wrong-typed field names the path (hosts must be string|string[])", () => {
  let err: unknown;
  try {
    loadPlaybook(`
- hosts: 123
  tasks: [{ name: t, module: ping, args: {} }]
`);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(ZodError);
  const msg = String((err as Error).message);
  expect(msg).toContain("hosts");
});

test("wrong-typed task field names the nested path", () => {
  let err: unknown;
  try {
    loadPlaybook(`
- hosts: all
  tasks:
    - name: t
      module: 5
      args: {}
`);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(ZodError);
  const msg = String((err as Error).message);
  expect(msg).toContain("tasks");
  expect(msg).toContain("module");
});

// --- Template ref lint: Jinja `{{ }}` unsupported, `$var` must be vars.-prefixed
test("lintTemplateRefs flags raw Jinja {{ }} in string values", () => {
  const pb: NormalizedPlaybook = {
    hosts: ["web"],
    vars: { port: 80 },
    tasks: [
      { name: "t", module: "shell", args: { command: "echo {{ host }}" }, notify: [] },
    ],
  };
  const problems = lintTemplateRefs(pb);
  expect(problems.length).toBe(1);
  expect(problems[0]?.kind).toBe("jinja");
});

test("lintTemplateRefs flags a $var whose first segment is not a known namespace", () => {
  const pb: NormalizedPlaybook = {
    hosts: ["web"],
    vars: { hostname: "web" },
    tasks: [
      { name: "t", module: "shell", args: { command: { $var: "hostname" } }, notify: [] },
    ],
  };
  const problems = lintTemplateRefs(pb);
  expect(problems.length).toBe(1);
  expect(problems[0]?.kind).toBe("namespace-unknown");
});

test("lintTemplateRefs passes a vars.-prefixed $var", () => {
  const pb = loadPlaybook(`
- hosts: web
  vars: { role: web }
  tasks:
    - name: t
      module: shell
      args: { command: { $var: vars.role } }
`);
  expect(lintTemplateRefs(pb[0]!)).toEqual([]);
});

test("loadPlaybook rejects Jinja {{ }} as a load-time error", () => {
  let err: unknown;
  try {
    loadPlaybook(`
- hosts: web
  tasks:
    - name: t
      module: shell
      args: { command: "echo {{ host }}" }
`);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(Error);
  expect(String((err as Error).message)).toContain("template-refs");
});

test("loadPlaybook rejects a $var whose first segment is not a known namespace", () => {
  let err: unknown;
  try {
    loadPlaybook(`
- hosts: web
  vars: { hostname: web }
  tasks:
    - name: t
      module: shell
      args: { command: { $var: hostname } }
`);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(Error);
  expect(String((err as Error).message)).toContain("template-refs");
});

test("loadPlaybook accepts a correct vars.-prefixed $var playbook", () => {
  expect(() =>
    loadPlaybook(`
- hosts: web
  vars: { role: web }
  tasks:
    - name: t
      module: shell
      args: { command: { $var: vars.role } }
`),
  ).not.toThrow();
});

// --- Round-trip: serialize(normalized) deep-equals normalized -------------
test("round-trip playbook: serialize(normalized) === normalized", async () => {
  const pb = await loadPlaybookFile(
    join(fixtures, "playbook.valid.yaml"),
  );
  deepEqual(serializePlaybook(pb[0]!), pb[0]!);
});

test("round-trip inventory: serialize(normalized) === normalized", async () => {
  const inv = await loadInventoryFile(
    join(fixtures, "inventory.valid.yaml"),
  );
  deepEqual(serializeInventory(inv), inv);
});

// --- import_playbook / include_tasks load-time expansion (Todo 5) ---------
test("loadPlaybookFile expands play-level imports (spliced into tasks)", async () => {
  // imports resolve relative to the project source root (here: the fixtures dir).
  const pb = await loadPlaybookFile(
    "playbook.import.yaml",
    new FsProjectSource(fixtures),
  );
  expect(pb).toHaveLength(1);
  expect(pb[0]?.hosts).toEqual(["web"]);
  expect(pb[0]?.tasks.map((t) => t.name)).toEqual([
    "local task",
    "imported one",
    "imported two",
  ]);
  // imports directive is consumed by expansion
  expect(pb[0]?.imports).toBeUndefined();
});

test("loadPlaybookFile expands task-level include_tasks at the directive index", async () => {
  const pb = await loadPlaybookFile(join(fixtures, "playbook.include.yaml"));
  expect(pb[0]?.tasks.map((t) => t.name)).toEqual([
    "before",
    "included alpha",
    "included beta",
    "after",
  ]);
  // the directive task itself is replaced (no include_tasks left in tasks)
  expect(
    pb[0]?.tasks.some((t) => t.include_tasks !== undefined),
  ).toBe(false);
});

test("expanded tasks inherit the parent play hosts by default", async () => {
  const pb = await loadPlaybookFile(join(fixtures, "playbook.include.yaml"));
  // Only the spliced-in (included) tasks inherit the parent hosts; original tasks
  // rely on the play-level hosts at execution time.
  const included = pb[0]!.tasks.filter((t) =>
    ["included alpha", "included beta"].includes(t.name),
  );
  expect(included).toHaveLength(2);
  for (const t of included) {
    expect(t.hosts).toEqual(["web"]);
  }
});

test("an included task keeps its own hosts when present", async () => {
  const pb = await loadPlaybookFile(
    join(fixtures, "playbook.include.ownhosts.yaml"),
  );
  expect(pb[0]?.tasks.map((t) => t.name)).toEqual(["inherited", "own"]);
  expect(pb[0]?.tasks[0]?.hosts).toEqual(["web"]); // inherited
  expect(pb[0]?.tasks[1]?.hosts).toEqual(["db"]); // own hosts honored
});

test("circular import/include throws a clear circular-import error", async () => {
  let err: unknown;
  try {
    await loadPlaybookFile(
      "circular.a.yaml",
      new FsProjectSource(fixtures),
    );
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(Error);
  expect(String((err as Error).message)).toContain("circular");
});

test("round-trip invariant holds for an expanded (imported) playbook", async () => {
  const pb = await loadPlaybookFile(join(fixtures, "playbook.include.yaml"));
  deepEqual(serializePlaybook(pb[0]!), pb[0]!);
});

test("serialize preserves the new fields (imports/include_tasks/hosts) round-trip", () => {
  const raw = [
    {
      name: "p",
      hosts: ["web"],
      imports: ["other.yaml"],
      tasks: [
        { name: "t1", module: "ping", args: {}, notify: [] as string[] },
        {
          name: "t2",
          module: "shell",
          args: {},
          notify: [],
          hosts: ["db"],
          include_tasks: "inc.yaml",
        },
      ],
      vars: {},
    },
  ];
  const normalized = normalizePlaybook(raw as never)[0]!;
  deepEqual(serializePlaybook(normalized), normalized);
});

// --- ADR 0008: $template operator (opt-in render; bare strings stay literal) --------
function varsScope(extra: Record<string, unknown> = {}): TemplateVars {
  return {
    host: "web1",
    vars: { host: "web1", ...extra },
    facts: {},
    item: undefined,
    index: undefined,
  };
}

test("bare strings are never rendered (only $template opts in)", () => {
  const out = renderArgs({ cmd: "echo <%= host %>" }, varsScope(), {});
  expect(out.cmd).toBe("echo <%= host %>");
});

test("$template operator renders an opt-in EJS string", () => {
  const out = renderArgs({ cmd: { $template: "echo <%= host %>" } }, varsScope(), {});
  expect(out.cmd).toBe("echo web1");
});

test("evalWhen treats a bare string literally and resolves structured predicates", () => {
  const vars = varsScope({ flag: false });
  expect(evalWhen("<%= vars.flag %>", vars)).toBe(true);
  expect(evalWhen({ $eq: [{ $var: "vars.host" }, "web1"] }, vars)).toBe(true);
});

test("expandLoop treats a bare string literally; $each resolves", () => {
  const vars = varsScope({ list: "[1,2,3]" });
  expect(expandLoop("<%= vars.list %>", vars)).toHaveLength(1);
  expect(expandLoop({ $each: { $var: "vars.list" } }, vars)).toHaveLength(3);
});

test("normalizePlaybook does not carry a templating field", () => {
  const pb = normalizePlaybook([{ hosts: "web", tasks: [] }] as never)[0]!;
  expect((pb as Record<string, unknown>).templating).toBeUndefined();
});

test("loadPlaybook rejects the removed templating keyword as an unknown key", () => {
  expect(() =>
    loadPlaybook(`
- hosts: web
  templating: strict
  tasks:
    - name: t
      module: shell
      args: { command: "echo {{ host }}" }
`),
  ).toThrow();
});

// --- T16: array-of-plays normalization (combined with per-play vars) ----
test("array-of-plays normalizes to an array of plays", () => {
  const pb = loadPlaybook(`
- name: play one
  hosts: web
  vars: { host: web1 }
  tasks:
    - name: t1
      module: shell
      args: { command: "echo <%= host %>" }
- name: play two
  hosts: db
  vars: { host: db1 }
  tasks:
    - name: t2
      module: shell
      args: { command: "echo <%= vars.host %>" }
`);
  expect(Array.isArray(pb)).toBe(true);
  expect(pb).toHaveLength(2);
  const cmd1 = renderArgs(pb[0]!.tasks[0]!.args, varsScope({ host: "web1" }), {}).command;
  expect(cmd1).toBe("echo <%= host %>");
});
