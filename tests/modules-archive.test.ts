// Hermetic tests for the Ansible-parity additions on `archive`/`unarchive`/`assemble`.
// Every OS call is routed through an in-memory scripted Connection that records
// commands and returns canned output. Bun-only MVP.

import { expect, test } from "bun:test";
import type { ModuleContext } from "../src/executor/module";
import type { ExecResult } from "../src/transport/connection";
import { createNoopConnection } from "../src/executor/context";
import { archiveModule } from "../src/modules/builtins/archive";
import { unarchiveModule } from "../src/modules/builtins/unarchive";
import { assembleModule } from "../src/modules/builtins/assemble";

const ok = (stdout = ""): ExecResult => ({ exitCode: 0, stdout, stderr: "" });

function harness(
  args: Record<string, unknown>,
  router: (cmd: string) => ExecResult,
): { ctx: ModuleContext; calls: string[] } {
  const calls: string[] = [];
  const conn = createNoopConnection("h1");
  conn.exec = async (cmd: string): Promise<ExecResult> => {
    calls.push(cmd);
    return router(cmd);
  };
  return {
    ctx: { host: "h1", connection: conn, args, vars: {}, facts: {}, reg: {} } as ModuleContext,
    calls,
  };
}

test("archive remove:true issues rm -rf per src after a successful archive", async () => {
  const h = harness(
    { path: "/backup/etc.tar", src: ["/etc/nginx", "/etc/ssh"], remove: true, force_archive: true },
    (cmd) => {
      if (cmd.startsWith("tar -cf ")) return ok();
      if (cmd.startsWith("rm -rf ")) return ok();
      throw new Error(`unexpected command: ${cmd}`);
    },
  );
  const res = await archiveModule.run(h.ctx);
  expect(res.failed).toBeFalsy();
  const rms = h.calls.filter((c) => c.startsWith("rm -rf "));
  expect(rms.length).toBe(2);
  expect(rms).toContain("rm -rf '/etc/nginx'");
  expect(rms).toContain("rm -rf '/etc/ssh'");
});

test("archive exclude_path adds --exclude for tar and -x for zip", async () => {
  const tar = harness(
    { path: "/backup/etc.tar", src: ["/etc"], exclude_path: ["logs", "tmp"], force_archive: true },
    (cmd) => {
      if (cmd.startsWith("tar -cf ")) return ok();
      throw new Error(`unexpected command: ${cmd}`);
    },
  );
  await archiveModule.run(tar.ctx);
  const tarCmd = tar.calls.find((c) => c.startsWith("tar -cf ")) ?? "";
  expect(tarCmd).toContain("--exclude='logs'");
  expect(tarCmd).toContain("--exclude='tmp'");

  const zip = harness(
    { path: "/backup/etc.zip", src: ["/etc"], exclude_path: "logs", force_archive: true },
    (cmd) => {
      if (cmd.startsWith("zip -r ")) return ok();
      throw new Error(`unexpected command: ${cmd}`);
    },
  );
  await archiveModule.run(zip.ctx);
  const zipCmd = zip.calls.find((c) => c.startsWith("zip -r ")) ?? "";
  expect(zipCmd).toContain("-x 'logs'");
});

test("archive skips a destination at least as new as its sources unless force_archive", async () => {
  const h = harness(
    { path: "/backup/etc.tar", src: ["/etc"] },
    (cmd) => {
      if (cmd.startsWith("stat -c %Y ")) return ok("2000\n");
      if (cmd.startsWith("find ")) return ok("1000\n");
      throw new Error(`unexpected command: ${cmd}`);
    },
  );
  const res = await archiveModule.run(h.ctx);
  expect(res.changed).toBe(false);
  expect(res.skipped).toBe(true);
  expect(h.calls.some((c) => c.startsWith("tar -cf "))).toBe(false);

  const forced = harness(
    { path: "/backup/etc.tar", src: ["/etc"], force_archive: true },
    (cmd) => {
      if (cmd.startsWith("tar -cf ")) return ok();
      throw new Error(`unexpected command: ${cmd}`);
    },
  );
  const forcedRes = await archiveModule.run(forced.ctx);
  expect(forcedRes.changed).toBe(true);
  expect(forced.calls.some((c) => c.startsWith("tar -cf "))).toBe(true);
  expect(forced.calls.some((c) => c.startsWith("stat -c %Y "))).toBe(false);
});

test("unarchive keep_newer adds --keep-newer-files for tar and -n for zip", async () => {
  const tar = harness({ src: "/tmp/app.tar.gz", dest: "/opt/app", keep_newer: true }, () => ok());
  await unarchiveModule.run(tar.ctx);
  expect(tar.calls.some((c) => c.includes("--keep-newer-files"))).toBe(true);

  const zip = harness({ src: "/tmp/app.zip", dest: "/opt/app", keep_newer: true }, () => ok());
  await unarchiveModule.run(zip.ctx);
  expect(zip.calls.some((c) => c.includes("unzip") && c.includes("-n "))).toBe(true);
});

test("unarchive default omits keep-newer flags", async () => {
  const tar = harness({ src: "/tmp/app.tar.gz", dest: "/opt/app" }, () => ok());
  await unarchiveModule.run(tar.ctx);
  expect(tar.calls.some((c) => c.includes("--keep-newer-files"))).toBe(false);

  const zip = harness({ src: "/tmp/app.zip", dest: "/opt/app" }, () => ok());
  await unarchiveModule.run(zip.ctx);
  expect(zip.calls.some((c) => c.includes("unzip") && c.includes("-n "))).toBe(false);
});

test("assemble inserts delimiter between parts, not after the last", async () => {
  const h = harness(
    { src: "/etc/parts", dest: "/out/conf", delimiter: "\n---\n" },
    (cmd) => {
      if (cmd.startsWith("ls -1 ")) return ok("10-a.conf\n20-b.conf\n");
      if (cmd.includes("/etc/parts/10-a.conf")) return ok("AAA");
      if (cmd.includes("/etc/parts/20-b.conf")) return ok("BBB");
      if (cmd.startsWith("cat > ")) return ok();
      throw new Error(`unexpected command: ${cmd}`);
    },
  );
  await assembleModule.run(h.ctx);
  const write = h.calls.find((c) => c.startsWith("cat > ")) ?? "";
  expect(write).toContain("AAA\n---\nBBB");
  expect(write).not.toContain("BBB\n---\n");
});

test("assemble without delimiter keeps plain concatenation", async () => {
  const h = harness(
    { src: "/etc/parts", dest: "/out/conf" },
    (cmd) => {
      if (cmd.startsWith("ls -1 ")) return ok("10-a.conf\n20-b.conf\n");
      if (cmd.includes("/etc/parts/10-a.conf")) return ok("AAA");
      if (cmd.includes("/etc/parts/20-b.conf")) return ok("BBB");
      if (cmd.startsWith("cat > ")) return ok();
      throw new Error(`unexpected command: ${cmd}`);
    },
  );
  await assembleModule.run(h.ctx);
  const write = h.calls.find((c) => c.startsWith("cat > ")) ?? "";
  expect(write).toContain("AAABBB");
});
