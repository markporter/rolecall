// Hermetic tests for the Ansible-parity `synchronize` module: rsync runs on the
// controller and pushes/pulls over ssh (or stays local), idempotency is parsed
// from `--itemize-changes`, and binary/auth failures stay actionable. No real
// rsync or ssh process is ever spawned — the module's spawn/probe seams are faked.

import { expect, test } from "bun:test";

import type { ModuleContext } from "../src/executor/module";
import { createNoopConnection } from "../src/executor/context";
import {
  buildRsyncPlan,
  hasItemizedChanges,
  runSynchronize,
  type SpawnLike,
  type SpawnResultLike,
  type SynchronizeContextLike,
} from "../src/modules/builtins/synchronize";

function ctx(args: Record<string, unknown>, vars: Record<string, unknown> = {}): ModuleContext {
  return {
    host: "web1",
    connection: createNoopConnection("web1"),
    args,
    vars,
    facts: {},
    reg: {},
  } as ModuleContext;
}

function planCtx(vars: Record<string, unknown>, kind = "ssh"): SynchronizeContextLike {
  return { host: "web1", vars, connection: { kind } };
}

function okSpawn(stdout: string, calls: Array<{ command: string; args: string[] }> = []): SpawnLike {
  return (command, args): SpawnResultLike => {
    calls.push({ command, args: [...args] });
    return { status: 0, stdout, stderr: "" };
  };
}

test("push remote: controller src -> user@host:dest with ssh -e and port", () => {
  const plan = buildRsyncPlan(
    { src: "/srv/www/", dest: "/var/www/" },
    planCtx({ rolecall_connection: "ssh", rolecall_user: "deploy", rolecall_port: 2222 }),
  );

  expect(plan.command).toBe("rsync");
  expect(plan.mode).toBe("push");
  expect(plan.remote).toBe(true);
  expect(plan.args).toContain("/srv/www/");
  expect(plan.args).toContain("deploy@web1:/var/www/");
  const e = plan.args.indexOf("-e");
  expect(e).toBeGreaterThanOrEqual(0);
  expect(plan.args[e + 1]).toBe("ssh -p 2222 -o StrictHostKeyChecking=no");
});

test("push remote: rolecall_ssh_user/rolecall_ssh_port and rolecall_host overrides apply", () => {
  const plan = buildRsyncPlan(
    { src: "/src", dest: "/dst" },
    planCtx({ rolecall_ssh_user: "ansible", rolecall_ssh_port: 2200, rolecall_host: "10.0.0.9" }),
  );

  expect(plan.args).toContain("ansible@10.0.0.9:/dst");
  expect(plan.args).toContain("ssh -p 2200 -o StrictHostKeyChecking=no");
});

test("pull remote: user@host:src -> controller dest", () => {
  const plan = buildRsyncPlan(
    { mode: "pull", src: "/var/log/app.log", dest: "/tmp/collected/" },
    planCtx({ rolecall_connection: "ssh", rolecall_user: "deploy", rolecall_port: 2222 }),
  );

  expect(plan.mode).toBe("pull");
  expect(plan.args).toContain("deploy@web1:/var/log/app.log");
  expect(plan.args).toContain("/tmp/collected/");
  expect(plan.args).not.toContain("deploy@web1:/tmp/collected/");
});

test("local target from rolecall_connection: no ssh spec, local rsync", () => {
  const plan = buildRsyncPlan(
    { src: "/srv/www/", dest: "/var/www/" },
    planCtx({ rolecall_connection: "local" }, "ssh"),
  );

  expect(plan.remote).toBe(false);
  expect(plan.args).not.toContain("-e");
  expect(plan.args.some((arg) => arg.startsWith("deploy@"))).toBe(false);
  expect(plan.args).toContain("/srv/www/");
  expect(plan.args).toContain("/var/www/");
});

test("local target inferred from the connection kind when vars are silent", () => {
  const plan = buildRsyncPlan({ src: "/a", dest: "/b" }, planCtx({}, "local"));
  expect(plan.remote).toBe(false);
  expect(plan.args).not.toContain("-e");
});

test("delete, recursive, and rsync_opts are included", () => {
  const plan = buildRsyncPlan(
    {
      src: "/src/",
      dest: "/dst/",
      delete: true,
      recursive: false,
      rsync_opts: "--exclude '*.tmp' -v",
    },
    planCtx({ rolecall_connection: "local" }),
  );

  expect(plan.args).toContain("--delete");
  expect(plan.args).toContain("-r");
  expect(plan.args).not.toContain("-a");
  expect(plan.args).toContain("--exclude");
  expect(plan.args).toContain("*.tmp");
  expect(plan.args).toContain("-v");
});

test("recursive defaults to -a", () => {
  const plan = buildRsyncPlan({ src: "/src", dest: "/dst" }, planCtx({ rolecall_connection: "local" }));
  expect(plan.args).toContain("-a");
  expect(plan.args).toContain("--itemize-changes");
});

test("check/_check add --dry-run", () => {
  const withCheck = buildRsyncPlan(
    { src: "/src", dest: "/dst", check: true },
    planCtx({ rolecall_connection: "local" }),
  );
  const withGlobalCheck = buildRsyncPlan(
    { src: "/src", dest: "/dst", _check: true },
    planCtx({ rolecall_connection: "local" }),
  );

  expect(withCheck.args).toContain("--dry-run");
  expect(withGlobalCheck.args).toContain("--dry-run");
});

test("itemize parsing: changes/deletions count, headers and empty output do not", () => {
  expect(hasItemizedChanges("")).toBe(false);
  expect(hasItemizedChanges("sending incremental file list\n")).toBe(false);
  expect(hasItemizedChanges(">f+++++++++ index.html\n")).toBe(true);
  expect(hasItemizedChanges(".d..t...... assets/\n")).toBe(true);
  expect(hasItemizedChanges("*deleting   old.txt\n")).toBe(true);
});

test("changed: true when rsync reports itemized changes", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const res = await runSynchronize(ctx({ src: "/src", dest: "/dst" }), {
    spawn: okSpawn(">f+++++++++ index.html\n", calls),
    hasBinary: () => true,
  });

  expect(res.changed).toBe(true);
  expect(res.failed ?? false).toBe(false);
  expect(res.skipped ?? false).toBe(false);
  expect(calls.length).toBe(1);
  expect(calls[0]?.command).toBe("rsync");
});

test("unchanged: changed false and skipped true when itemize output is empty", async () => {
  const res = await runSynchronize(ctx({ src: "/src", dest: "/dst" }), {
    spawn: okSpawn(""),
    hasBinary: () => true,
  });

  expect(res.changed).toBe(false);
  expect(res.skipped).toBe(true);
  expect(res.failed ?? false).toBe(false);
});

test("missing rsync fails actionably without spawning", async () => {
  const spawn: SpawnLike = () => {
    throw new Error("rsync must not be spawned when the probe fails");
  };
  const res = await runSynchronize(ctx({ src: "/src", dest: "/dst" }), {
    spawn,
    hasBinary: (binary) => binary !== "rsync",
  });

  expect(res.changed).toBe(false);
  expect(res.failed).toBe(true);
  expect(String(res.msg)).toContain("rsync");
  expect(String(res.msg)).toContain("install");
});

test("missing ssh on a remote target fails actionably", async () => {
  const res = await runSynchronize(
    ctx({ src: "/src", dest: "/dst" }, { rolecall_connection: "ssh" }),
    {
      spawn: okSpawn(""),
      hasBinary: (binary) => binary === "rsync",
    },
  );

  expect(res.failed).toBe(true);
  expect(String(res.msg)).toContain("ssh");
  expect(String(res.msg)).toContain("install");
});

test("password-only ssh is rejected with key-auth guidance", async () => {
  const res = await runSynchronize(
    ctx(
      { src: "/src", dest: "/dst" },
      { rolecall_connection: "ssh", rolecall_password: "hunter2" },
    ),
    {
      spawn: () => {
        throw new Error("must not spawn for unsupported password auth");
      },
      hasBinary: () => true,
    },
  );

  expect(res.changed).toBe(false);
  expect(res.failed).toBe(true);
  expect(String(res.msg)).toContain("password");
  expect(String(res.msg)).toContain("key");
  expect(String(res.msg)).not.toContain("sshpass");
});

test("non-zero rsync status fails with captured stderr", async () => {
  const res = await runSynchronize(ctx({ src: "/src", dest: "/dst" }), {
    spawn: (): SpawnResultLike => ({ status: 23, stdout: "", stderr: "Permission denied\n" }),
    hasBinary: () => true,
  });

  expect(res.failed).toBe(true);
  expect(String(res.msg)).toContain("Permission denied");
});
