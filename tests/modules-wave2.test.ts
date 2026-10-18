// Built-in modules: Wave-2 parity (group / replace / template / get_url / git).
//
// Hermetic, portabltests over a scripted fake connection (no docker, no network,
// no root): every OS call is routed through an in-memory router keyed off the
// command string, returning realistic exec results. Bun-only MVP (bun test).

import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { ModuleContext } from "../src/executor/module";
import type { ExecResult } from "../src/transport/connection";
import { createNoopConnection } from "../src/executor/context";
import { groupModule } from "../src/modules/builtins/group";
import { replaceModule } from "../src/modules/builtins/replace";
import { getUrlModule } from "../src/modules/builtins/get_url";
import { gitModule } from "../src/modules/builtins/git";

type Router = (cmd: string) => ExecResult;

interface Harness {
  ctx: ModuleContext;
  calls: string[];
}

function harness(args: Record<string, unknown>, opts: { become?: boolean; router: Router }): Harness {
  const calls: string[] = [];
  const conn = createNoopConnection("h1");
  conn.exec = async (cmd: string): Promise<ExecResult> => {
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

const ok = (stdout = ""): ExecResult => ({ exitCode: 0, stdout, stderr: "" });
const fail = (stderr = ""): ExecResult => ({ exitCode: 1, stdout: "", stderr });

// ---------------------------------------------------------------------------
const groupAbsent: Router = (cmd) => {
  if (cmd.startsWith("getent group")) return fail();
  if (cmd.startsWith("groupadd") || cmd.startsWith("groupmod") || cmd.startsWith("groupdel")) return ok();
  throw new Error(`unexpected command: ${cmd}`);
};
const groupPresent = (gid: number): Router => (cmd) => {
  if (cmd.startsWith("getent group")) return ok(`deploy:x:${gid}:`);
  if (cmd.startsWith("groupadd") || cmd.startsWith("groupmod") || cmd.startsWith("groupdel")) return ok();
  throw new Error(`unexpected command: ${cmd}`);
};

test("group fails fast without a name", async () => {
  const h = harness({}, { router: groupAbsent });
  const res = await groupModule.run(h.ctx);
  expect(res.changed).toBe(false);
  expect(res.failed).toBe(true);
  expect(String(res.msg)).toContain("'name' is required");
  expect(h.calls.length).toBe(0);
});

test("group absent target issues groupadd and returns changed:true", async () => {
  const h = harness({ name: "deploy" }, { router: groupAbsent });
  const res = await groupModule.run(h.ctx);
  expect(res.changed).toBe(true);
  expect(res.data?.created).toBe(true);
  const create = h.calls.find((c) => c.startsWith("groupadd"));
  expect(create).toBeDefined();
});

test("group present + matches is a no-op", async () => {
  const h = harness({ name: "deploy" }, { router: groupPresent(2000) });
  const res = await groupModule.run(h.ctx);
  expect(res.changed).toBe(false);
  expect(res.msg).toContain("unchanged");
});

test("group present with drifted GID reconciles via groupmod", async () => {
  const h = harness({ name: "deploy", gid: 3000 }, { router: groupPresent(2000) });
  const res = await groupModule.run(h.ctx);
  expect(res.changed).toBe(true);
  expect(res.data?.gidChanged).toBe(true);
  const mod = h.calls.find((c) => c.startsWith("groupmod"));
  expect(mod).toContain("--gid 3000");
});

test("group state=absent removes an existing group", async () => {
  const h = harness({ name: "deploy", state: "absent" }, { router: groupPresent(2000) });
  const res = await groupModule.run(h.ctx);
  expect(res.changed).toBe(true);
  expect(h.calls.find((c) => c.startsWith("groupdel"))).toBeDefined();
});

test("group state=absent on missing group is a no-op", async () => {
  const h = harness({ name: "ghost", state: "absent" }, { router: groupAbsent });
  const res = await groupModule.run(h.ctx);
  expect(res.changed).toBe(false);
  expect(h.calls.some((c) => c.startsWith("groupdel"))).toBe(false);
});

test("group become prefixes privileged commands with sudo", async () => {
  const h = harness({ name: "svc" }, { become: true, router: groupAbsent });
  await groupModule.run(h.ctx);
  for (const call of h.calls) expect(call.startsWith("sudo ")).toBe(true);
});

// ---------------------------------------------------------------------------
function replaceRouter(current: string | null): Router {
  return (cmd) => {
    if (cmd.startsWith("cat ")) return current === null ? fail() : ok(current);
    if (cmd.startsWith("bash -c")) return ok("WROTE");
    if (cmd.startsWith("chmod") || cmd.startsWith("chown") || cmd.startsWith("chgrp")) return ok();
    throw new Error(`unexpected command: ${cmd}`);
  };
}

test("replace fails when target file is missing", async () => {
  const h = harness({ path: "/etc/foo", old: "a", replace: "b" }, { router: replaceRouter(null) });
  const res = await replaceModule.run(h.ctx);
  expect(res.failed).toBe(true);
  expect(String(res.msg)).toContain("cannot read");
});

test("replace is a no-op when content is unchanged", async () => {
  const h = harness({ path: "/etc/foo", old: "zzz", replace: "b" }, { router: replaceRouter("hello world") });
  const res = await replaceModule.run(h.ctx);
  expect(res.changed).toBe(false);
  expect(h.calls.some((c) => c.startsWith("bash -c"))).toBe(false);
});

test("replace writes back when a literal changes", async () => {
  const h = harness({ path: "/etc/foo", old: "world", replace: "there" }, { router: replaceRouter("hello world") });
  const res = await replaceModule.run(h.ctx);
  expect(res.changed).toBe(true);
  expect(h.calls.find((c) => c.startsWith("bash -c"))).toBeDefined();
});

test("replace applies a regexp rewrite", async () => {
  const router = replaceRouter("a1 b2 c3");
  const h = harness({ path: "/etc/foo", regexp: "[0-9]+", replace: "#" }, { router });
  const res = await replaceModule.run(h.ctx);
  expect(res.changed).toBe(true);
});

test("replace check mode reports wouldChange without writing", async () => {
  const h = harness({ path: "/etc/foo", old: "world", replace: "there", _check: true }, { router: replaceRouter("hello world") });
  const res = await replaceModule.run(h.ctx);
  expect(res.skipped).toBe(true);
  expect(res.data?.wouldChange).toBe(true);
  expect(h.calls.some((c) => c.startsWith("bash -c"))).toBe(false);
});

// ---------------------------------------------------------------------------
function getUrlRouter(initialChecksum: string | null, afterDownloadChecksum: string): Router {
  let shaCalls = 0;
  return (cmd) => {
    if (cmd.startsWith("test -e")) return initialChecksum === null ? fail() : ok();
    if (cmd.startsWith("sha256sum")) return ok(`${shaCalls++ === 0 ? initialChecksum : afterDownloadChecksum}  -\n`);
    if (cmd.startsWith("(")) return ok();
    if (cmd.startsWith("chmod") || cmd.startsWith("chown") || cmd.startsWith("chgrp")) return ok();
    throw new Error(`unexpected command: ${cmd}`);
  };
}

test("get_url is a no-op when present and checksum matches", async () => {
  const h = harness({ url: "http://e/f", dest: "/tmp/f", checksum: "sha256:abc" }, { router: getUrlRouter("abc", "abc") });
  const res = await getUrlModule.run(h.ctx);
  expect(res.changed).toBe(false);
  expect(res.skipped).toBe(true);
});

test("get_url downloads a missing file", async () => {
  const h = harness({ url: "http://e/f", dest: "/tmp/f" }, { router: getUrlRouter(null, "abc") });
  const res = await getUrlModule.run(h.ctx);
  expect(res.changed).toBe(true);
  expect(h.calls.some((c) => c.startsWith("("))).toBe(true);
});

test("get_url re-downloads and verifies when checksum mismatches", async () => {
  const h = harness({ url: "http://e/f", dest: "/tmp/f", checksum: "sha256:abc" }, { router: getUrlRouter("def", "abc") });
  const res = await getUrlModule.run(h.ctx);
  expect(res.changed).toBe(true);
  const verify = h.calls.filter((c) => c.startsWith("sha256sum"));
  expect(verify.length).toBeGreaterThanOrEqual(2);
});

test("get_url check mode reports wouldChange without downloading", async () => {
  const h = harness({ url: "http://e/f", dest: "/tmp/f", _check: true }, { router: getUrlRouter(null, "abc") });
  const res = await getUrlModule.run(h.ctx);
  expect(res.skipped).toBe(true);
  expect(res.data?.wouldChange).toBe(true);
  expect(h.calls.some((c) => c.startsWith("("))).toBe(false);
});

// ---------------------------------------------------------------------------
function gitRouter(exists: boolean, head: string, versionResolved: string, dirty = false, headAfterPull = versionResolved): Router {
  let pulled = false;
  return (cmd) => {
    if (cmd.startsWith("test -d")) return exists ? ok() : fail();
    if (cmd.startsWith("git clone")) return ok();
    if (cmd.startsWith("git -C")) {
      if (cmd.includes("status --porcelain")) return dirty ? ok(" M file\n") : ok("");
      if (cmd.includes("fetch")) return ok();
      if (cmd.includes("rev-parse HEAD")) return ok(pulled ? headAfterPull : head);
      if (cmd.includes("rev-parse")) return ok(versionResolved);
      if (cmd.includes("stash push")) return ok();
      if (cmd.includes("pull")) {
        pulled = true;
        return ok();
      }
      if (cmd.includes("reset --hard")) return ok();
      if (cmd.includes("checkout") && cmd.includes("reset")) return ok();
    }
    throw new Error(`unexpected command: ${cmd}`);
  };
}

test("git clones a missing repo", async () => {
  const h = harness({ repo: "https://e/r", dest: "/opt/r" }, { router: gitRouter(false, "", "") });
  const res = await gitModule.run(h.ctx);
  expect(res.changed).toBe(true);
  expect(h.calls.find((c) => c.startsWith("git clone"))).toBeDefined();
});

test("git present with matching version is a no-op", async () => {
  const h = harness({ repo: "https://e/r", dest: "/opt/r", version: "v1" }, { router: gitRouter(true, "aaa", "aaa") });
  const res = await gitModule.run(h.ctx);
  expect(res.changed).toBe(false);
  expect(h.calls.some((c) => c.includes("checkout"))).toBe(false);
});

test("git present with differing version checks out", async () => {
  const h = harness({ repo: "https://e/r", dest: "/opt/r", version: "v2" }, { router: gitRouter(true, "aaa", "bbb") });
  const res = await gitModule.run(h.ctx);
  expect(res.changed).toBe(true);
  expect(h.calls.find((c) => c.includes("checkout -f"))).toBeDefined();
});

test("git check mode reports wouldChange without checking out", async () => {
  const h = harness({ repo: "https://e/r", dest: "/opt/r", version: "v2", _check: true }, { router: gitRouter(true, "aaa", "bbb") });
  const res = await gitModule.run(h.ctx);
  expect(res.skipped).toBe(true);
  expect(res.data?.wouldChange).toBe(true);
  expect(h.calls.some((c) => c.includes("checkout -f"))).toBe(false);
});

test("git stashes a dirty tree before a no-op update", async () => {
  const h = harness({ repo: "https://e/r", dest: "/opt/r", stash: true }, { router: gitRouter(true, "aaa", "aaa", true) });
  const res = await gitModule.run(h.ctx);
  expect(res.skipped).toBe(true);
  expect(res.data?.stashed).toBe(true);
  expect(h.calls.some((c) => c.includes("stash push"))).toBe(true);
});

test("git reset head discards working changes", async () => {
  const h = harness({ repo: "https://e/r", dest: "/opt/r", reset: true }, { router: gitRouter(true, "aaa", "aaa", true) });
  const res = await gitModule.run(h.ctx);
  expect(res.changed).toBe(true);
  expect(h.calls.find((c) => c.includes("reset --hard 'HEAD'"))).toBeDefined();
});

test("git reset to a ref when HEAD differs", async () => {
  const h = harness({ repo: "https://e/r", dest: "/opt/r", reset: "bbb" }, { router: gitRouter(true, "aaa", "bbb", false) });
  const res = await gitModule.run(h.ctx);
  expect(res.changed).toBe(true);
  expect(h.calls.find((c) => c.includes("reset --hard 'bbb'"))).toBeDefined();
});

test("git pull updates the working tree", async () => {
  const h = harness({ repo: "https://e/r", dest: "/opt/r", pull: true }, { router: gitRouter(true, "aaa", "aaa", false, "bbb") });
  const res = await gitModule.run(h.ctx);
  expect(res.changed).toBe(true);
  expect(h.calls.some((c) => c.includes(" pull"))).toBe(true);
});

test("git check mode reports wouldReset without resetting", async () => {
  const h = harness({ repo: "https://e/r", dest: "/opt/r", reset: true, _check: true }, { router: gitRouter(true, "aaa", "aaa", true) });
  const res = await gitModule.run(h.ctx);
  expect(res.skipped).toBe(true);
  expect(res.data?.wouldChange).toBe(true);
  expect(h.calls.some((c) => c.includes("reset --hard"))).toBe(false);
});
