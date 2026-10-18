// Integration test: PROVES the executor executes tasks end-to-end over the SSH
// transport, using the project's in-process SSH *simulator* (OFFLINE, no docker/
// lxc/podman, no real localhost sshd).
//
// The stale docs label the executor + transport as "later" scaffold, yet this
// suite drives the REAL pipeline end to end against a scripted ssh2 server:
//   YAML playbook + inventory  ->  loadPlaybookFile / loadInventoryFile
//   -> resolveTargets          ->  runPlaybook(connectionFor = SshConnection)
//   -> cli module.run          ->  conn.exec(command) over the simulated socket
//
// Why this is REAL execution (not a dry-run no-op):
//   - The sim ONLY answers commands listed in its `execHandlers`. We key the
//     handler output to a UNIQUE token ("SIM_EXEC_OK_42") that appears nowhere in
//     source except the sim script. If the executor fell back to the no-op
//     connection (`createNoopConnection`), exec returns "" and every stdout/token
//     assertion below FAILS. So matching the token proves a genuine SSH round-trip.
//   - `changed: true` proves the `cli` converge path actually ran `conn.exec`
//     (a dry_run path reports changed:false + msg "would run…", never executed).
//   - Exactly one connection is constructed per matched host via `connectionFor`
//     (the noop fallback would construct ZERO); all are disconnected afterwards.
//
// Keep everything Bun-only: ROLECALL_RUNTIME=node PAL surfaces throw "deferred past MVP".
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { FsProjectSource } from "../../src/vfs/fs-project-source";
import { loadInventoryFile, loadPlaybookFile } from "../../src/config/loader";
import { runPlaybook } from "../../src/executor/engine";
import { registerAllModules } from "../../src/modules/builtins/index";
import type { TaskEvent } from "../../src/executor/context";
import { SshConnection } from "../../src/transport/ssh";
import { createSshSim, type SshSimHandle } from "../../src/testing/sims/ssh-server";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

// Register the shipped modules ONCE before any runPlaybook() call so the `cli`
// module (and friends) are resolvable by name at dispatch time. Idempotent.
registerAllModules();

const NO_RETRY = { retries: 0, minTimeout: 10, maxTimeout: 50, factor: 2, randomize: false };

/** Unique marker emitted by the sim for the primary task command. */
const EXEC_TOKEN = "SIM_EXEC_OK_42";

// Track created sims + temp dirs so they are always torn down (no leaks).
const closed: Array<{ close(): void }> = [];
const tempDirs: string[] = [];

afterEach(() => {
  for (const c of closed.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
});

/** Write inventory.yaml + playbook.yaml into a fresh temp dir; return its path. */
function writeTempFiles(inventoryYaml: string, playbookYaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "rolecall-exec-sim-"));
  tempDirs.push(dir);
  writeFileSync(join(dir, "inventory.yaml"), inventoryYaml);
  writeFileSync(join(dir, "playbook.yaml"), playbookYaml);
  return dir;
}

interface SimTarget {
  handle: SshSimHandle;
  conns: SshConnection[];
}

/** Start an ephemeral sim with the given handlers; build a tracked SshConnection factory. */
async function startSim(handlers: Record<string, string>): Promise<SimTarget> {
  const handle = await createSshSim({ port: 0, execHandlers: handlers });
  closed.push(handle);
  const conns: SshConnection[] = [];
  // The executor resolves a Connection per host via `connectionFor` but never
  // connects it — the returned object must already be connected so the module's
  // `conn.exec(command)` round-trips over the simulated socket.
  const connectionFor = async (): Promise<SshConnection> => {
    const conn = new SshConnection({
      kind: "ssh",
      host: handle.host,
      port: handle.port,
      user: handle.user,
      credentials: { privateKey: readFileSync(handle.privateKeyPath, "utf-8") },
      knownHostsPath: handle.knownHostsPath,
      strictHostKeyChecking: true,
      retry: NO_RETRY,
      timeoutMs: 8000,
    });
    await conn.connect();
    conns.push(conn);
    return conn;
  };
  return { handle, conns, connectionFor };
}

describe("executor end-to-end over SSH (simulated)", () => {
  test("runs a cli task on the simulated host and captures real stdout + changed state", async () => {
    const inv = `groups:\n  web:\n    hosts: ["web1"]\n`;
    // Plain command (no creates/removes/dry_run) -> cli ALWAYS applies, changed:true.
    const pb = [
      `- hosts: web`,
      `  tasks:`,
      `    - name: echo the execution token`,
      `      module: shell`,
      `      args:`,
      `        command: "echo ${EXEC_TOKEN}"`,
      `        run_mode: always`,
    ].join("\n");

    const dir = writeTempFiles(inv, pb);
    const playbook = await loadPlaybookFile(join(dir, "playbook.yaml"));
    const inventory = await loadInventoryFile(join(dir, "inventory.yaml"));

    const sim = await startSim({ [`echo ${EXEC_TOKEN}`]: `${EXEC_TOKEN}\n` });
    const result = await runPlaybook(playbook, inventory, { connectionFor: sim.connectionFor });

    const host = "web1";
    const outcomes = result.hosts[host];
    expect(outcomes).toBeDefined();
    expect(outcomes!.length).toBe(1);
    const o = outcomes![0]!;

    // --- REAL execution proof ------------------------------------------------
    // The executor built exactly one connection per matched host through
    // connectionFor (the noop fallback would build ZERO — and yield empty stdout).
    expect(sim.conns.length).toBe(1);
    // changed:true proves converge actually ran conn.exec (dry-run reports false).
    expect(o.changed).toBe(true);
    expect(o.failed).toBe(false);
    // The captured stdout carries the UNIQUE sim token → genuine SSH round-trip.
    const stdout = o.iterations[0]?.stdout ?? "";
    expect(stdout).toContain(EXEC_TOKEN);
    expect(stdout.trim()).toBe(EXEC_TOKEN);
    // Module metadata records the executed command + exit code.
    expect((o.iterations[0]?.data as Record<string, unknown>)?.exitCode).toBe(0);
    expect((o.iterations[0]?.data as Record<string, unknown>)?.command).toBe(`echo ${EXEC_TOKEN}`);
    expect(o.iterations[0]?.msg).toBe(`ran: echo ${EXEC_TOKEN}`);

    // Tear down the single connection we were handed by the engine.
    await sim.conns[0]!.disconnect();
  });

  test("skips tasks whose `when` guard evaluates false (control flow)", async () => {
    const inv = `groups:\n  web:\n    hosts: ["web1"]\n`;
    const pb = [
      `- hosts: web`,
      `  tasks:`,
      `    - name: runs normally`,
      `      module: shell`,
      `      args:`,
      `        command: "echo first"`,
      `        run_mode: always`,
      `    - name: guarded off`,
      `      module: shell`,
      `      args:`,
      `        command: "echo should-not-run"`,
      `        run_mode: always`,
      `      when: false`,
    ].join("\n");

    const dir = writeTempFiles(inv, pb);
    const playbook = await loadPlaybookFile(join(dir, "playbook.yaml"));
    const inventory = await loadInventoryFile(join(dir, "inventory.yaml"));

    const sim = await startSim({
      "echo first": "first\n",
      "echo should-not-run": "should-not-run\n",
    });
    const result = await runPlaybook(playbook, inventory, { connectionFor: sim.connectionFor });

    const outcomes = result.hosts["web1"];
    expect(outcomes!.length).toBe(2);

    // Task 0 executed for real.
    expect(outcomes![0]!.changed).toBe(true);
    expect(outcomes![0]!.iterations[0]?.stdout).toContain("first");

    // Task 1 was NOT executed: its iteration is marked skipped and produced no output.
    const guarded = outcomes![1]!;
    expect(guarded.skipped).toBe(false); // top-level outcome not itself "skipped"
    expect(guarded.changed).toBe(false);
    expect(guarded.failed).toBe(false);
    expect(guarded.iterations.length).toBe(1);
    expect(guarded.iterations[0]?.skipped).toBe(true);
    expect(guarded.iterations[0]?.stdout).toBeUndefined();

    await sim.conns[0]!.disconnect();
  });

  test("expands a `loop` into multiple real executions on the same host", async () => {
    const inv = `groups:\n  web:\n    hosts: ["web1"]\n`;
    // Constant command keeps templating out of the way; expansion is proven by count.
    const pb = [
      `- hosts: web`,
      `  tasks:`,
      `    - name: loop three times`,
      `      module: shell`,
      `      args:`,
      `        command: "echo loop-step"`,
      `        run_mode: always`,
      `      loop: [0, 1, 2]`,
    ].join("\n");

    const dir = writeTempFiles(inv, pb);
    const playbook = await loadPlaybookFile(join(dir, "playbook.yaml"));
    const inventory = await loadInventoryFile(join(dir, "inventory.yaml"));

    const sim = await startSim({ "echo loop-step": "loop-step\n" });
    const result = await runPlaybook(playbook, inventory, { connectionFor: sim.connectionFor });

    const iterations = result.hosts["web1"]![0]!.iterations;
    // One task expanded into exactly N loop iterations, each executed.
    expect(iterations.length).toBe(3);
    for (const it of iterations) {
      expect(it.index).toBeGreaterThanOrEqual(0);
      expect(it.changed).toBe(true);
      expect(it.failed).toBe(false);
      expect(it.stdout).toContain("loop-step");
    }

    await sim.conns[0]!.disconnect();
  });

  test("load-time include_tasks splices included tasks that execute for real", async () => {
    const inv = `groups:\n  web:\n    hosts: ["web1"]\n`;
    const pb = [
      `- hosts: web`,
      `  tasks:`,
      `    - name: direct`,
      `      module: shell`,
      `      args:`,
      `        command: "echo DIRECT"`,
      `        run_mode: always`,
      `    - name: include directive`,
      `      include_tasks: included.yaml`,
    ].join("\n");

    const dir = writeTempFiles(inv, pb);
    // Included file lives next to the playbook so it resolves against the file dir.
    writeFileSync(
      join(dir, "included.yaml"),
      [
        `- hosts: included`,
        `  tasks:`,
        `    - name: included one`,
        `      module: shell`,
        `      args:`,
        `        command: "echo INCLUDED_ONE"`,
        `        run_mode: always`,
        `    - name: included two`,
        `      module: shell`,
        `      args:`,
        `        command: "echo INCLUDED_TWO"`,
        `        run_mode: always`,
      ].join("\n"),
    );

    const playbook = await loadPlaybookFile(join(dir, "playbook.yaml"));
    const inventory = await loadInventoryFile(join(dir, "inventory.yaml"));

    // Expansion is load-time: the loaded play already has the 3 resolved tasks.
    expect(playbook[0]!.tasks.map((t) => t.name)).toEqual([
      "direct",
      "included one",
      "included two",
    ]);

    const sim = await startSim({
      "echo DIRECT": "DIRECT\n",
      "echo INCLUDED_ONE": "INCLUDED_ONE\n",
      "echo INCLUDED_TWO": "INCLUDED_TWO\n",
    });
    const result = await runPlaybook(playbook, inventory, {
      connectionFor: sim.connectionFor,
    });

    const outcomes = result.hosts["web1"];
    expect(outcomes).toBeDefined();
    // All three (direct + two included) executed — proving expansion reaches the executor.
    expect(outcomes!.length).toBe(3);
    const stdout = outcomes!.map((o) => o.iterations[0]?.stdout ?? "").join("|");
    expect(stdout).toContain("DIRECT");
    expect(stdout).toContain("INCLUDED_ONE");
    expect(stdout).toContain("INCLUDED_TWO");

    await sim.conns[0]!.disconnect();
  });

  test("playbook-level imports expand and execute for real over sim", async () => {
    const inv = `groups:\n  web:\n    hosts: ["web1"]\n`;
    const pb = [
      `- hosts: web`,
      `  imports: [imported.yaml]`,
      `  tasks:`,
      `    - name: direct`,
      `      module: shell`,
      `      args:`,
      `        command: "echo DIRECT_IMPORT"`,
      `        run_mode: always`,
    ].join("\n");

    const dir = writeTempFiles(inv, pb);
    writeFileSync(
      join(dir, "imported.yaml"),
      [
        `- hosts: imported`,
        `  tasks:`,
        `    - name: imported one`,
        `      module: shell`,
        `      args:`,
        `        command: "echo IMPORTED_ONE"`,
        `        run_mode: always`,
        `    - name: imported two`,
        `      module: shell`,
        `      args:`,
        `        command: "echo IMPORTED_TWO"`,
        `        run_mode: always`,
      ].join("\n"),
    );

    const playbook = await loadPlaybookFile(
      join(dir, "playbook.yaml"),
      new FsProjectSource(dir),
    );
    const inventory = await loadInventoryFile(join(dir, "inventory.yaml"));

    expect(playbook[0]!.tasks.map((t) => t.name)).toEqual([
      "direct",
      "imported one",
      "imported two",
    ]);

    const sim = await startSim({
      "echo DIRECT_IMPORT": "DIRECT_IMPORT\n",
      "echo IMPORTED_ONE": "IMPORTED_ONE\n",
      "echo IMPORTED_TWO": "IMPORTED_TWO\n",
    });
    const result = await runPlaybook(playbook, inventory, {
      connectionFor: sim.connectionFor,
    });

    const outcomes = result.hosts["web1"];
    expect(outcomes).toBeDefined();
    expect(outcomes!.length).toBe(3);
    const stdout = outcomes!.map((o) => o.iterations[0]?.stdout ?? "").join("|");
    expect(stdout).toContain("DIRECT_IMPORT");
    expect(stdout).toContain("IMPORTED_ONE");
    expect(stdout).toContain("IMPORTED_TWO");

    await sim.conns[0]!.disconnect();
  });

  test("circular import/include is rejected at load time (never reaches execution)", async () => {
    let err: unknown;
    try {
      await loadPlaybookFile("circular.a.yaml", new FsProjectSource(fixtures));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).toContain("circular");
  });

  test("bare command stays literal (no rendering) over real SSH", async () => {
    const inv = `groups:\n  web:\n    hosts: ["web1"]\n`;
    // The bare `command: "echo <%= host %>"` is NOT rendered — the
    // literal string is what executes. The sim handler is keyed to the exact
    // literal command, so a match proves the executor passed the unrendered string.
    const pb = [
      `- hosts: web`,
      `  vars:`,
      `    host: web1`,
      `  tasks:`,
      `    - name: literal command`,
      `      module: shell`,
      `      args:`,
      `        command: "echo <%= host %>"`,
      `        run_mode: always`,
    ].join("\n");

    const dir = writeTempFiles(inv, pb);
    const playbook = await loadPlaybookFile(join(dir, "playbook.yaml"));
    const inventory = await loadInventoryFile(join(dir, "inventory.yaml"));

    const sim = await startSim({ [`echo <%= host %>`]: `${EXEC_TOKEN}\n` });
    const result = await runPlaybook(playbook, inventory, { connectionFor: sim.connectionFor });

    const o = result.hosts["web1"]![0]!;
    expect(o.failed).toBe(false);
    expect(o.changed).toBe(true);
    const stdout = o.iterations[0]?.stdout ?? "";
    expect(stdout).toContain(EXEC_TOKEN);
    // The rendered form (echo web1) must NOT appear — the value stayed literal.
    expect(stdout).not.toContain("echo web1");

    await sim.conns[0]!.disconnect();
  });

  test("$template operator renders over real SSH", async () => {
    const inv = `groups:\n  web:\n    hosts: ["web1"]\n`;
    const pb = [
      `- hosts: web`,
      `  vars:`,
      `    host: web1`,
      `  tasks:`,
      `    - name: opt-in template`,
      `      module: shell`,
      `      args:`,
      `        command: { $template: "echo <%= vars.host %>" }`,
      `        run_mode: always`,
    ].join("\n");

    const dir = writeTempFiles(inv, pb);
    const playbook = await loadPlaybookFile(join(dir, "playbook.yaml"));
    const inventory = await loadInventoryFile(join(dir, "inventory.yaml"));

    const sim = await startSim({ [`echo web1`]: `${EXEC_TOKEN}\n` });
    const result = await runPlaybook(playbook, inventory, { connectionFor: sim.connectionFor });

    const o = result.hosts["web1"]![0]!;
    expect(o.failed).toBe(false);
    const stdout = o.iterations[0]?.stdout ?? "";
    expect(stdout).toContain(EXEC_TOKEN);

    await sim.conns[0]!.disconnect();
  });

  // --- T16: multi-play array executes ALL plays, syslog sink emits per-task events
  test("multi-play array executes tasks from all plays and emits per-task syslog events", async () => {
    const inv = `groups:\n  web:\n    hosts: ["web1"]\n`;
    // A top-level ARRAY of plays: both must run, each contributing its own tasks.
    const pb = [
      `- hosts: web`,
      `  tasks:`,
      `    - name: play one task`,
      `      module: shell`,
      `      args:`,
      `        command: "echo MULTI_PLAY_ONE"`,
      `        run_mode: always`,
      `- hosts: web`,
      `  tasks:`,
      `    - name: play two task`,
      `      module: shell`,
      `      args:`,
      `        command: "echo MULTI_PLAY_TWO"`,
      `        run_mode: always`,
    ].join("\n");

    const dir = writeTempFiles(inv, pb);
    const playbook = await loadPlaybookFile(join(dir, "playbook.yaml"));
    const inventory = await loadInventoryFile(join(dir, "inventory.yaml"));

    // The file normalized into a 2-element array of plays.
    expect(playbook).toHaveLength(2);

    // Capture the realtime per-task event sink (the syslog sink) inline.
    const events: TaskEvent[] = [];
    const sim = await startSim({
      "echo MULTI_PLAY_ONE": "MULTI_PLAY_ONE\n",
      "echo MULTI_PLAY_TWO": "MULTI_PLAY_TWO\n",
    });
    const result = await runPlaybook(playbook, inventory, {
      connectionFor: sim.connectionFor,
      eventSink: (e: TaskEvent) => events.push(e),
    });

    // Every play's tasks executed — each play's token appears in the captured stdout.
    const outcomes = result.hosts["web1"];
    expect(outcomes).toBeDefined();
    expect(outcomes!.length).toBe(2);
    const stdout = outcomes!.map((o) => o.iterations[0]?.stdout ?? "").join("|");
    expect(stdout).toContain("MULTI_PLAY_ONE");
    expect(stdout).toContain("MULTI_PLAY_TWO");

    // The syslog sink emitted exactly one per-task event for each executed task.
    expect(events).toHaveLength(2);
    const tasks = events.map((e) => e.task).sort();
    expect(tasks).toEqual(["play one task", "play two task"]);
    for (const e of events) {
      expect(e.host).toBe("web1");
      expect(e.status).toBeDefined();
    }

    await sim.conns[0]!.disconnect();
  });
});
