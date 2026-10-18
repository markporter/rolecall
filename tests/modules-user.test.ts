// Built-in module: `user` (P9) — imperative probe-and-write idempotency over a
// mocked connection so tests stay hermetic/portable (no docker, no root): every
// OS call is routed through an in-memory script keyed off the command string,
// returning realistic `/etc/passwd`-style lines instead of touching the host.
// Bun-only MVP (bun test).

import { expect, test } from "bun:test";
import type { ModuleContext } from "../src/executor/module";
import type { ExecResult } from "../src/transport/connection";
import { createNoopConnection } from "../src/executor/context";
import { userModule } from "../src/modules/builtins/user";

/** Route any executed command to a scripted {@link ExecResult} based on its text. */
type Router = (cmd: string) => ExecResult;

/** A real Local-like Connection whose `exec` is redirected through a scripted router. */
interface Harness {
  ctx: ModuleContext;
  /** Every command string passed to `conn.exec`, in order. */
  calls: string[];
}

/** Build a fully-typed local {@link ModuleContext} driven by a scripted router. */
function harness(args: Record<string, unknown>, opts: { become?: boolean; router: Router }): Harness {
  const calls: string[] = [];
  const conn = createNoopConnection("h1");
  conn.exec = async (cmd: string): Promise<ExecResult> => {
    // Record the raw command (with any `sudo ` prefix intact); route the router on
    // the post-sudo form so scripted responses don't depend on privilege escalation.
    calls.push(cmd);
    const target = cmd.startsWith("sudo ") ? cmd.slice(5) : cmd;
    return opts.router(target);
  };
  const ctx: ModuleContext = {
    host: "h1",
    connection: conn,
    args,
    vars: {},
    facts: {},
    registered: {},
    become: opts.become ?? false,
  };
  return { ctx, calls };
}

/** Render a canonical seven-field `/etc/passwd` entry (`name:x:uid:gid:gecos:home:shell`). */
const passwdLine = (name: string, uid: number, gid: number, home: string, shell: string): string =>
  [name, "x", String(uid), String(gid), "", "", home, shell].join(":");

/** Scripted responses implying the account does not exist yet. */
const absentRouter: Router = (cmd) => {
  if (cmd.startsWith("getent passwd")) return { exitCode: 1, stdout: "", stderr: "" };
  if (cmd.startsWith("id -u")) return { exitCode: 1, stdout: "", stderr: "" };
  if (cmd.startsWith("useradd") || cmd.startsWith("usermod")) return { exitCode: 0, stdout: "", stderr: "" };
  throw new Error(`unexpected command: ${cmd}`);
};

/** Scripted responses implying the account already exists with these attributes. */
const presentRouter = (line: string): Router => (cmd) => {
  if (cmd.startsWith("getent passwd")) return { exitCode: 0, stdout: line, stderr: "" };
  if (cmd.startsWith("id -u")) return { exitCode: 0, stdout: "1001", stderr: "" };
  if (cmd.startsWith("groups ")) return { exitCode: 0, stdout: "bob : adm cdrom sudo\n", stderr: "" };
  if (cmd.startsWith("usermod")) return { exitCode: 0, stdout: "", stderr: "" };
  if (cmd.startsWith("userdel")) return { exitCode: 0, stdout: "", stderr: "" };
  if (cmd.startsWith("echo ") && cmd.includes("chpasswd")) return { exitCode: 0, stdout: "", stderr: "" };
  throw new Error(`unexpected command: ${cmd}`);
};

// --- required-name validation ----------------------------------------------
test("user fails fast without a name", async () => {
  const h = harness({}, { router: absentRouter });
  const res = await userModule.run(h.ctx);
  expect(res.changed).toBe(false);
  expect(res.failed).toBe(true);
  expect(String(res.msg)).toContain("'name' is required");
  expect(h.calls.length).toBe(0);
});

// --- absent -> creates ------------------------------------------------------
test("absent target issues a useradd and returns changed:true", async () => {
  const h = harness({ name: "deploy" }, { router: absentRouter });
  const res = await userModule.run(h.ctx);
  expect(res.changed).toBe(true);
  expect(res.data?.created).toBe(true);
  const createCall = h.calls.find((c) => c.startsWith("useradd"));
  expect(createCall).toBeDefined();
  expect(createCall).toContain("--create-home"); // default honored when omitted
});

// --- present + matches -> unchanged -----------------------------------------
test("present+matches leaves the account untouched (changed:false)", async () => {
  const line = passwdLine("bob", 1001, 1001, "/home/bob", "/bin/bash");
  const h = harness({ name: "bob" }, { router: presentRouter(line) });
  const res = await userModule.run(h.ctx);
  expect(res.changed).toBe(false);
  expect(res.msg).toContain("unchanged");
  expect(h.calls.filter((c) => c.startsWith("getent")).length).toBe(1);
  expect(h.calls.some((c) => /user(add|mod|del)/.test(c))).toBe(false);
});

// --- drift reconciliation ---------------------------------------------------
test("present but wrong uid reconciles via usermod", async () => {
  const line = passwdLine("bob", 1001, 1001, "/home/bob", "/bin/bash");
  const h = harness({ name: "bob", uid: 2000 }, { router: presentRouter(line) });
  const res = await userModule.run(h.ctx);
  expect(res.changed).toBe(true);
  expect(res.data?.reconciled).toBe(true);
  const mod = h.calls.find((c) => c.startsWith("usermod"));
  expect(mod).toContain("--uid 2000");
});

// --- groups reconcile (replace) ---------------------------------------------
test("present with desired groups syncs them via usermod --groups", async () => {
  const line = passwdLine("bob", 1001, 1001, "/home/bob", "/bin/bash");
  const h = harness({ name: "bob", groups: "www-data,adm" }, { router: presentRouter(line) });
  const res = await userModule.run(h.ctx);
  expect(res.changed).toBe(true);
  expect(res.data?.groupSynced).toBe(true);
  const mod = h.calls.find((c) => c.startsWith("usermod"));
  expect(mod).toContain("--groups 'www-data,adm'");
});

// --- password applied only when provided ------------------------------------
test("password applies once via chpasswd and marks changed", async () => {
  const line = passwdLine("bob", 1001, 1001, "/home/bob", "/bin/bash");
  const h = harness({ name: "bob", password: "s3cret" }, { router: presentRouter(line) });
  const res = await userModule.run(h.ctx);
  expect(res.changed).toBe(true);
  expect(res.data?.passwordChanged).toBe(true);
  expect(h.calls.some((c) => c.includes("chpasswd"))).toBe(true);
});

// --- privilege escalation ---------------------------------------------------
test("become prefixes every privileged command with sudo", async () => {
  const h = harness({ name: "svc" }, { become: true, router: absentRouter });
  await userModule.run(h.ctx);
  const createCall = h.calls.find((c) => c.replace(/^sudo /, "").startsWith("useradd"));
  expect(createCall?.startsWith("sudo useradd")).toBe(true);
  for (const call of h.calls) expect(call.startsWith("sudo ")).toBe(true);
});

// --- absent state ------------------------------------------------------------
test("state=absent on an already-absent account is a no-op (changed:false)", async () => {
  const router: Router = (cmd) => {
    if (cmd.startsWith("getent passwd")) return { exitCode: 1, stdout: "", stderr: "" };
    if (cmd.startsWith("id -u")) return { exitCode: 1, stdout: "", stderr: "" };
    throw new Error(`unexpected command: ${cmd}`);
  };
  const h = harness({ name: "ghost", state: "absent" }, { router });
  const res = await userModule.run(h.ctx);
  expect(res.changed).toBe(false);
  expect(res.failed).toBe(undefined);
  expect(h.calls.some((c) => /user(del|\bdelete\b)/.test(c))).toBe(false);
});

test("state=absent removes an existing account, with -r when requested", async () => {
  const line = passwdLine("old", 5000, 5000, "/home/old", "/bin/sh");
  const h = harness({ name: "old", state: "absent", remove: true }, { router: presentRouter(line) });
  const res = await userModule.run(h.ctx);
  expect(res.changed).toBe(true);
  expect(res.data?.deletedHome).toBe(true);
  const del = h.calls.find((c) => c.startsWith("userdel"));
  expect(del).toContain("-r");
  expect(h.calls.filter((c) => c.startsWith("getent")).length).toBe(1); // getent short-circuits id -u
});

// --- mock realism -----------------------------------------------------------
test("mock returns realistic /etc/passwd output that the module parses", async () => {
  const scripted = passwdLine("carol", 4242, 4242, "/home/carol", "/usr/bin/fish");
  let seenGetentStdout = "";
  const router: Router = (cmd) => {
    if (cmd.startsWith("getent passwd")) {
      seenGetentStdout = scripted;
      return { exitCode: 0, stdout: scripted, stderr: "" };
    }
    if (cmd.startsWith("id -u")) return { exitCode: 0, stdout: "4242", stderr: "" };
    if (cmd.startsWith("usermod")) return { exitCode: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected command: ${cmd}`);
  };
  const h = harness({ name: "carol", shell: "/bin/zsh" }, { router });
  const res = await userModule.run(h.ctx);
  expect(seenGetentStdout).toBe(scripted); // proves the mock emits real-looking lines
  expect(res.changed).toBe(true);
  expect(res.data?.reconciled).toBe(true);
  const mod = h.calls.find((c) => c.startsWith("usermod"));
  expect(mod).toContain("--shell '/bin/zsh'"); // shell parsed from passwd field[6], then reconciled
});
