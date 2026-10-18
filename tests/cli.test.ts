// CLI integration tests (Wave 1, Todo 5). Bun-only MVP (bun test).
//
// These spawn `bun bin/rolecall.js ...` as a REAL subprocess (per the task spec) and
// assert on the structured stdout. The subprocess approach exercises the full
// argv path (parseArgs dispatch + output plugins) exactly as an end user would.
//
// Coverage:
//   (a) --version / --help exit 0 with expected content
//   (b) playbook run --inventory --output json -> resolved hosts + skeleton
//   (c) inventory show|list --output json -> resolved hosts / sorted groups
//   (d) facts gather --output json -> resolved targets
//   (e) plugin list --output json -> registered plugins
//   (f) unknown command / subcommand / output plugin -> non-zero exit, no trace
import { expect, test, mock, spyOn } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const binPath = join(here, "..", "bin", "rolecall.js");
const fixtures = join(here, "fixtures");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runRolecall(args: string[]): Promise<RunResult> {
  const proc = Bun.spawn(["bun", binPath, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

// --- (a) version / help -----------------------------------------------------
test("--version prints package.json version and exits 0", async () => {
  const r = await runRolecall(["--version"]);
  expect(r.code).toBe(0);
  expect(r.stdout.trim()).toBe("rolecall 0.0.0");
});

test("--help lists subcommands and exits 0", async () => {
  const r = await runRolecall(["--help"]);
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("playbook run");
  expect(r.stdout).toContain("facts gather");
  expect(r.stdout).toContain("inventory show");
  expect(r.stdout).toContain("plugin");
});

test("no args prints help and exits 0", async () => {
  const r = await runRolecall([]);
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("Subcommands:");
});

// --- (b) playbook run -------------------------------------------------------
test("playbook run --inventory --output json resolves hosts + skeleton", async () => {
  const r = await runRolecall([
    "playbook",
    "run",
    join(fixtures, "playbook.valid.yaml"),
    "--inventory",
    join(fixtures, "inventory.valid.yaml"),
    "--output",
    "json",
  ]);
  const data = JSON.parse(r.stdout) as {
    command: string;
    resolvedHosts: string[];
    tasks: { name: string; module: string }[];
    skeleton: { host: string; task: string; module: string }[];
    totals?: { failed: number };
  };
  expect(data.command).toBe("playbook run");
  // inventory.valid.yaml group "web" -> web1, web2 (sorted, deterministic).
  expect(data.resolvedHosts).toEqual(["web1.example.com", "web2.example.com"]);
  // 3 tasks in the fixture.
  expect(data.tasks.length).toBe(3);
  // skeleton = 2 hosts x 3 tasks = 6 pairs.
  expect(data.skeleton.length).toBe(6);
  // host names sorted; first pair host is the lexicographically smallest.
  expect(data.skeleton[0]!.host).toBe("web1.example.com");
  // Exit code must track the failure contract (1 when totals.failed > 0).
  expect(r.code).toBe((data.totals?.failed ?? 0) > 0 ? 1 : 0);
});

test("playbook run --limit restricts resolved hosts", async () => {
  const r = await runRolecall([
    "playbook",
    "run",
    join(fixtures, "playbook.valid.yaml"),
    "--inventory",
    join(fixtures, "inventory.valid.yaml"),
    "--limit",
    "web1.example.com",
    "--output",
    "json",
  ]);
  const data = JSON.parse(r.stdout) as { resolvedHosts: string[]; totals?: { failed: number } };
  expect(data.resolvedHosts).toEqual(["web1.example.com"]);
  // Exit code must track the failure contract (1 when totals.failed > 0).
  expect(r.code).toBe((data.totals?.failed ?? 0) > 0 ? 1 : 0);
});

test("playbook run without --inventory exits 0 with empty skeleton (documented)", async () => {
  const r = await runRolecall([
    "playbook",
    "run",
    join(fixtures, "playbook.valid.yaml"),
    "--output",
    "json",
  ]);
  expect(r.code).toBe(0);
  const data = JSON.parse(r.stdout) as { resolvedHosts: string[]; skeleton: unknown[] };
  expect(data.resolvedHosts).toEqual([]);
  expect(data.skeleton).toEqual([]);
});

// --- (b2) load-time include_tasks reflected in the task list ----------------
test("playbook run reflects load-time include_tasks expansion in tasks", async () => {
  const r = await runRolecall([
    "playbook",
    "run",
    join(fixtures, "playbook.include.yaml"),
    "--output",
    "json",
  ]);
  expect(r.code).toBe(0);
  const data = JSON.parse(r.stdout) as {
    tasks: { name: string; module: string }[];
  };
  // The `include_tasks` directive is spliced at load time, so the CLI's task
  // list already shows the expanded, resolved tasks (not the directive).
  expect(data.tasks.map((t) => t.name)).toEqual([
    "before",
    "included alpha",
    "included beta",
    "after",
  ]);
});

// --- (c) inventory show | list ---------------------------------------------
test("inventory show --output json prints resolved hosts + vars", async () => {
  const r = await runRolecall([
    "inventory",
    "show",
    join(fixtures, "inventory.valid.yaml"),
    "--output",
    "json",
  ]);
  expect(r.code).toBe(0);
  const data = JSON.parse(r.stdout) as {
    command: string;
    matchedHosts: string[];
    hosts: Record<string, Record<string, unknown>>;
  };
  expect(data.command).toBe("inventory show");
  expect(data.matchedHosts).toEqual([
    "db1.example.com",
    "web1.example.com",
    "web2.example.com",
  ]);
  // var keys sorted; web group sets role=web.
  expect(data.hosts["web1.example.com"]).toEqual({ role: "web" });
  expect(data.hosts["db1.example.com"]).toEqual({});
});

test("inventory list --output json prints sorted group names", async () => {
  const r = await runRolecall([
    "inventory",
    "list",
    join(fixtures, "inventory.valid.yaml"),
    "--output",
    "json",
  ]);
  expect(r.code).toBe(0);
  const data = JSON.parse(r.stdout) as { command: string; groups: string[] };
  expect(data.command).toBe("inventory list");
  expect(data.groups).toEqual(["db", "web"]);
});

test("inventory show consumes an Ansible INI inventory directly (auto-detected)", async () => {
  const r = await runRolecall([
    "inventory",
    "show",
    join(fixtures, "ansible-inventory.ini"),
    "--output",
    "json",
  ]);
  expect(r.code).toBe(0);
  const data = JSON.parse(r.stdout) as {
    command: string;
    matchedHosts: string[];
    hosts: Record<string, Record<string, unknown>>;
  };
  expect(data.command).toBe("inventory show");
  expect(data.matchedHosts).toEqual([
    "db1.example.com",
    "edge1.example.com",
    "web1.example.com",
    "web2.example.com",
  ]);
  // Child-over-parent group precedence + host-over-group, resolved by the engine.
  expect(data.hosts["web1.example.com"]).toEqual({
    ansible_user: "deploy",
    env: "production",
    http_port: 80,
    region: "us-east",
    retries: 3,
    role: "web",
  });
  expect(data.hosts["edge1.example.com"]).toEqual({
    env: "production",
    region: "us-east",
    retries: 3,
    role: "web",
  });
});

test("inventory show consumes an Ansible YAML inventory directly (auto-detected)", async () => {
  const r = await runRolecall([
    "inventory",
    "show",
    join(fixtures, "ansible-inventory.yaml"),
    "--output",
    "json",
  ]);
  expect(r.code).toBe(0);
  const data = JSON.parse(r.stdout) as {
    command: string;
    matchedHosts: string[];
    hosts: Record<string, Record<string, unknown>>;
  };
  expect(data.command).toBe("inventory show");
  expect(data.matchedHosts).toEqual([
    "db1.example.com",
    "edge1.example.com",
    "web1.example.com",
    "web2.example.com",
  ]);
  expect(data.hosts["web1.example.com"]).toEqual({
    ansible_user: "deploy",
    env: "production",
    http_port: 80,
    retries: 3,
    role: "web",
  });
});

// --- (d) facts gather -------------------------------------------------------
test("facts gather --output json resolves all targets", async () => {
  const r = await runRolecall([
    "facts",
    "gather",
    join(fixtures, "inventory.valid.yaml"),
    "--output",
    "json",
  ]);
  expect(r.code).toBe(0);
  const data = JSON.parse(r.stdout) as { command: string; resolvedHosts: string[] };
  expect(data.command).toBe("facts gather");
  expect(data.resolvedHosts).toEqual([
    "db1.example.com",
    "web1.example.com",
    "web2.example.com",
  ]);
});

// --- (e) plugin list --------------------------------------------------------
test("plugin list --output json lists registered plugins", async () => {
  const r = await runRolecall(["plugin", "list", "--output", "json"]);
  expect(r.code).toBe(0);
  const data = JSON.parse(r.stdout) as {
    command: string;
    plugins: { name: string; type: string; source: string; path?: string }[];
  };
  expect(data.command).toBe("plugin list");
  expect(data.plugins.some((p) => p.name === "static" && p.source === "inventory")).toBe(true);
  expect(data.plugins.some((p) => p.name === "dynamic" && p.source === "inventory")).toBe(true);
});

// --- (f) error paths (non-zero exit, no stack trace) ------------------------
test("unknown command exits non-zero with a helpful message", async () => {
  const r = await runRolecall(["bogus"]);
  expect(r.code).not.toBe(0);
  expect(r.stderr).toContain("unknown command");
  expect(r.stderr).not.toContain("at ");
});

test("unknown subcommand exits non-zero", async () => {
  const r = await runRolecall(["playbook", "bogus"]);
  expect(r.code).not.toBe(0);
  expect(r.stderr).toContain("unknown playbook subcommand");
});

test("unknown output plugin exits non-zero", async () => {
  const r = await runRolecall([
    "--output",
    "bogus",
    "inventory",
    "list",
    join(fixtures, "inventory.valid.yaml"),
  ]);
  expect(r.code).not.toBe(0);
  expect(r.stderr).toContain("unknown output plugin");
});

test("missing required argument exits non-zero", async () => {
  const r = await runRolecall(["playbook", "run"]);
  expect(r.code).not.toBe(0);
  expect(r.stderr).toContain("requires a <file>");
});

test("invalid --forks exits non-zero", async () => {
  const r = await runRolecall([
    "inventory",
    "list",
    join(fixtures, "inventory.valid.yaml"),
    "--forks",
    "abc",
  ]);
  expect(r.code).not.toBe(0);
  expect(r.stderr).toContain("--forks must be a number");
});

// --- (f2) tag flags ---------------------------------------------------------
test("playbook run --tags filters the resolved task list", async () => {
  const r = await runRolecall([
    "playbook",
    "run",
    join(fixtures, "playbook.tags.yaml"),
    "--inventory",
    join(fixtures, "inventory.local.yaml"),
    "--tags",
    "web",
    "--output",
    "json",
  ]);
  expect(r.code).toBe(0);
  const data = JSON.parse(r.stdout) as {
    totals: { ok: number; changed: number; failed: number; skipped: number };
    outcomes: { task: string; skipped: boolean; msg?: string }[];
  };
  expect(data.totals.failed).toBe(0);
  expect(data.totals.ok).toBe(1);
  expect(data.totals.skipped).toBe(1);
  const skipped = data.outcomes.find((o) => o.task === "untagged task")!;
  expect(skipped.skipped).toBe(true);
  expect(skipped.msg).toContain("tag-filtered");
});

test("playbook run with an empty --tags value exits 2 (usage error)", async () => {
  const r = await runRolecall([
    "playbook",
    "run",
    join(fixtures, "playbook.tags.yaml"),
    "--tags",
    "",
  ]);
  expect(r.code).toBe(2);
  expect(r.stderr).toContain("--tags requires at least one tag name");
});

test("playbook run with an empty --skip-tags value exits 2 (usage error)", async () => {
  const r = await runRolecall([
    "playbook",
    "run",
    join(fixtures, "playbook.tags.yaml"),
    "--skip-tags",
    "   ",
  ]);
  expect(r.code).toBe(2);
  expect(r.stderr).toContain("--skip-tags requires at least one tag name");
});

// --- (g) docs modules -------------------------------------------------------
test("docs modules --output json lists all modules with name + description + args", async () => {
  const r = await runRolecall(["docs", "modules", "--output", "json"]);
  expect(r.code).toBe(0);
  const data = JSON.parse(r.stdout) as {
    command: string;
    query: string;
    count: number;
    modules: { name: string; description: string; args?: unknown }[];
  };
  expect(data.command).toBe("docs modules");
  expect(data.query).toBe("");
   const names = data.modules.map((m) => m.name).sort();
   expect(names).toEqual(
       [
        "acl",
        "add_host",
        "apt_repository",
        "archive",
        "assemble",
        "assert",
        "authorized_key",
        "blockinfile",
        "command",
        "config_edit",
        "copy",
        "cron",
        "debug",
        "fail",
        "fetch",
        "file",
        "filesystem",
        "find",
        "get_url",
        "git",
        "group",
        "group_info",
        "hostname",
        "http",
        "iptables",
        "json_query",
        "known_hosts",
        "lineinfile",
        "locale_gen",
        "lvg",
        "lvol",
        "meta",
        "modprobe",
        "mount",
        "openssl_certificate",
        "package",
        "pam_limits",
        "parted",
        "pause",
        "raw",
        "replace",
        "script",
        "selinux",
        "service",
        "service_facts",
         "set_fact",
         "set_reg",
         "set_stats",
        "shell",
        "slurp",
        "sql",
        "stat",
        "synchronize",
        "sysctl",
        "tempfile",
        "timezone",
        "ufw",
        "unarchive",
        "user",
        "user_info",
        "wait_for",
        "yum_repository",
      ].sort(),
    );
  for (const m of data.modules) {
    expect(typeof m.description).toBe("string");
    expect(m.description.length).toBeGreaterThan(0);
  }
});

test("docs modules <term> filters to a single module", async () => {
  const r = await runRolecall(["docs", "modules", "http", "--output", "json"]);
  expect(r.code).toBe(0);
  const data = JSON.parse(r.stdout) as {
    query: string;
    count: number;
    modules: { name: string }[];
  };
  expect(data.query).toBe("http");
  expect(data.count).toBe(1);
  expect(data.modules[0]!.name).toBe("http");
});

test("docs modules unknown subcommand exits non-zero", async () => {
  const r = await runRolecall(["docs", "bogus", "--output", "json"]);
  expect(r.code).not.toBe(0);
  expect(r.stderr).toContain("unknown docs subcommand");
});

test("docs search edit returns the module-reference page", async () => {
  const r = await runRolecall(["docs", "search", "edit", "--output", "json"]);
  expect(r.code).toBe(0);
  const data = JSON.parse(r.stdout) as {
    hits: { file: string }[];
  };
  const files = data.hits.map((h) => h.file);
  expect(files.some((f) => f.includes("module-reference"))).toBe(true);
});

// --- T3: writeOut NUL-strip + exit-code regression --------------------------

/** A minimal PlaybookRunResult whose `totals.failed` drives the exit code. */
function fakePlaybookResult(failed: number) {
  return {
    command: "playbook run",
    playbook: "x.yaml",
    mode: "applied",
    flags: { force: false, check: false, diff: false },
    resolvedHosts: ["h1"],
    tasks: [],
    skeleton: [],
    totals: { ok: 0, changed: 0, failed, skipped: 0 },
    note: "",
  } as const;
}

// A single mutable holder lets both exit-code tests share one mocked module.
let fakeResult = fakePlaybookResult(0);
mock.module("../src/cli/commands/playbook", () => ({
  runPlaybookCommand: async () => fakeResult,
}));
const { main, writeOut } = await import("../src/cli/index");

test("writeOut strips NUL/control chars when output is json", () => {
  const writeSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    const dirty = "he\x00llo\x01world\x7f";
    writeOut(dirty, "json");
    expect(writeSpy.mock.calls[0]![0]).toBe("helloworld");
  } finally {
    writeSpy.mockRestore();
  }
});

test("writeOut does NOT strip control chars for non-json output", () => {
  const writeSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    writeOut("he\x00llo", "human");
    expect(writeSpy.mock.calls[0]![0]).toBe("he\x00llo");
  } finally {
    writeSpy.mockRestore();
  }
});

test("main returns 1 when a playbook run has totals.failed > 0", async () => {
  fakeResult = fakePlaybookResult(2);
  const code = await main(["bun", "rolecall", "playbook", "run", "x.yaml", "--output", "json"]);
  expect(code).toBe(1);
});

test("main returns 0 when a playbook run has no failures", async () => {
  fakeResult = fakePlaybookResult(0);
  const code = await main(["bun", "rolecall", "playbook", "run", "x.yaml", "--output", "json"]);
  expect(code).toBe(0);
});

test("main returns 0 for non-playbook commands", async () => {
  fakeResult = fakePlaybookResult(5); // would fail if mis-applied
  const code = await main(["bun", "rolecall", "inventory", "list", join(fixtures, "inventory.valid.yaml")]);
  expect(code).toBe(0);
});

test("playbook run -o json emits ZERO NUL bytes on stdout (T3 NUL hygiene)", async () => {
  const r = await runRolecall([
    "playbook",
    "run",
    join(fixtures, "playbook.cli-nul.yaml"),
    "--inventory",
    join(fixtures, "inventory.local.yaml"),
    "--output",
    "json",
  ]);
  expect(r.code).toBe(0);
  expect(r.stdout.indexOf("\0")).toBe(-1);
  expect(Buffer.from(r.stdout).includes(0)).toBe(false);
  expect(() => JSON.parse(r.stdout)).not.toThrow();
});

test("playbook run with a failing task exits 1 (T3 exit-code contract)", async () => {
  const r = await runRolecall([
    "playbook",
    "run",
    join(fixtures, "playbook.cli-fail.yaml"),
    "--inventory",
    join(fixtures, "inventory.local.yaml"),
    "--output",
    "json",
  ]);
  expect(r.code).toBe(1);
  const data = JSON.parse(r.stdout) as { totals: { failed: number; ok: number } };
  expect(data.totals.failed).toBeGreaterThan(0);
  expect(data.totals.ok).toBe(0);
});

test("playbook run on a bare-object playbook exits non-zero with a list-required message", async () => {
  const r = await runRolecall([
    "playbook",
    "run",
    join(fixtures, "playbook.bare-object.yaml"),
    "--output",
    "json",
  ]);
  expect(r.code).not.toBe(0);
  expect(r.stderr).toContain("playbook must be a list of plays");
  expect(r.stderr).toContain("wrap the play in a top-level list");
});

test("idempotency warning lands on STDERR, not STDOUT (T3 stream hygiene)", async () => {
  const r = await runRolecall([
    "playbook",
    "run",
    join(fixtures, "playbook.cli-warn.yaml"),
    "--inventory",
    join(fixtures, "inventory.local.yaml"),
    "--output",
    "json",
  ]);
  // An unguarded shell task now both emits the idempotency warning (stderr) AND
  // throws at apply time, so the run exits 1. The stream-hygiene contract still holds.
  expect(r.code).toBe(1);
  expect(r.stderr).toContain("[rolecall:idempotency]");
  expect(r.stderr).toContain("no idempotency guard");
  expect(r.stdout).not.toContain("[rolecall:idempotency]");
  expect(() => JSON.parse(r.stdout)).not.toThrow();
});

// --- T14/T16: default output is syslog (realtime per-task JSON lines) ----------
test("default output (no -o) is syslog: streams per-task JSON lines to stdout", async () => {
  const r = await runRolecall([
    "playbook",
    "run",
    join(fixtures, "playbook.cli-nul.yaml"),
    "--inventory",
    join(fixtures, "inventory.local.yaml"),
  ]);
  expect(r.stdout).not.toContain("Playbook :");
  const lines = r.stdout.split("\n").filter((l) => l.trim().length > 0);
  expect(lines.length).toBeGreaterThanOrEqual(1);
  for (const line of lines) {
    const obj = JSON.parse(line) as {
      host: string;
      task: string;
      module: string;
      status: string;
      msg: string;
    };
    expect(obj.host).toBeDefined();
    expect(obj.task).toBeDefined();
    expect(obj.module).toBeDefined();
    expect(obj.status).toBeDefined();
  }
});

test("playbook run -o human_summary prints the human-readable end-of-run summary", async () => {
  const r = await runRolecall([
    "playbook",
    "run",
    join(fixtures, "playbook.cli-nul.yaml"),
    "--inventory",
    join(fixtures, "inventory.local.yaml"),
    "--output",
    "human_summary",
  ]);
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("Playbook :");
  expect(r.stdout).toContain("Summary");
  expect(r.stdout).toContain("localhost");
});

