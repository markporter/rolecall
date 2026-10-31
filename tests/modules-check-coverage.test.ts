// Per-module check() coverage for global `--check`.
//
// Each module's `check` method is exercised through a scripted in-memory
// connection (no docker/root/network). We assert the pure observed-vs-desired
// verdict for both already-satisfied and drifted states.

import { expect, test } from "bun:test";
import type { Connection, ExecResult } from "../src/transport/connection";
import type { ModuleContext } from "../src/executor/module";
import type { CheckableModule } from "../src/idempotency";

import { fileModule } from "../src/modules/builtins/file";
import { pkgModule } from "../src/modules/builtins/package";
import { serviceModule } from "../src/modules/builtins/service";
import { userModule } from "../src/modules/builtins/user";
import { sysctlModule } from "../src/modules/builtins/sysctl";
import { mountModule } from "../src/modules/builtins/mount";
import { knownHostsModule } from "../src/modules/builtins/known_hosts";
import { selinuxModule } from "../src/modules/builtins/selinux";
import { lvolModule } from "../src/modules/builtins/lvol";
import { firewalldModule } from "../src/modules/builtins/firewalld";
import { iptablesModule } from "../src/modules/builtins/iptables";
import { partedModule } from "../src/modules/builtins/parted";
import { filesystemModule } from "../src/modules/builtins/filesystem";
import { aclModule } from "../src/modules/builtins/acl";
import { ufwModule } from "../src/modules/builtins/ufw";

const ok = (stdout = ""): ExecResult => ({ exitCode: 0, stdout, stderr: "" });
const fail = (stderr = "not found"): ExecResult => ({ exitCode: 1, stdout: "", stderr });

function ctx(router: (cmd: string) => ExecResult, args: Record<string, unknown>): ModuleContext {
  const conn: Connection = {
    kind: "local",
    async connect() {},
    async disconnect() {},
    async facts() { return { host: "h1", user: "ci", transport: "local" }; },
    async health() { return { ok: true }; },
    async exec(cmd: string) { return router(cmd.replace(/^sudo /, "")); },
  };
  return { host: "h1", connection: conn, args, vars: {}, facts: {}, reg: {}, loop: undefined } as ModuleContext;
}

async function desired(mod: Module & Partial<CheckableModule>, args: Record<string, unknown>, router: (cmd: string) => ExecResult): Promise<boolean> {
  expect(typeof mod.check).toBe("function");
  const r = await mod.check!(args, ctx(router, args));
  return r.inDesired;
}

test("file check: matching directory attrs are desired; mode drift is not", async () => {
  const router = (cmd: string): ExecResult => {
    if (cmd.startsWith("[ -e") || cmd.startsWith("[ -d")) return ok();
    if (cmd.includes("stat -c")) return ok("0755 root root\n");
    throw new Error(`unexpected: ${cmd}`);
  };
  expect(await desired(fileModule, { path: "/srv", state: "directory", mode: "0755" }, router)).toBe(true);
  expect(await desired(fileModule, { path: "/srv", state: "directory", mode: "0700" }, router)).toBe(false);
});

test("package check: installed desired for present, not for absent", async () => {
  const router = (cmd: string): ExecResult => {
    if (cmd.startsWith("which apt-get")) return ok();
    if (cmd.startsWith("dpkg -s nginx")) return ok();
    return fail();
  };
  expect(await desired(pkgModule, { name: "nginx" }, router)).toBe(true);
  expect(await desired(pkgModule, { name: "nginx", state: "absent" }, router)).toBe(false);
});

test("service check: enabled+active desired; stopped/disabled are not", async () => {
  const router = (cmd: string): ExecResult => {
    if (cmd.startsWith("command -v systemctl")) return ok();
    if (cmd.includes("is-enabled")) return ok();
    if (cmd.includes("is-active")) return ok();
    return fail();
  };
  expect(await desired(serviceModule, { name: "nginx" }, router)).toBe(true);
  expect(await desired(serviceModule, { name: "nginx", state: "stopped" }, router)).toBe(false);
  expect(await desired(serviceModule, { name: "nginx", enabled: false }, router)).toBe(false);
});

test("user check: matching attrs desired, uid drift not, absent handled", async () => {
  const router = (cmd: string): ExecResult => {
    if (cmd.startsWith("getent passwd") && cmd.includes("alice")) return ok("alice:x:1050:1050::/home/alice:/bin/bash\n");
    return fail();
  };
  expect(await desired(userModule, { name: "alice", uid: 1050, home: "/home/alice", shell: "/bin/bash" }, router)).toBe(true);
  expect(await desired(userModule, { name: "alice", uid: 2000 }, router)).toBe(false);
  expect(await desired(userModule, { name: "alice", state: "absent" }, router)).toBe(false);
  expect(await desired(userModule, { name: "nobody", state: "absent" }, router)).toBe(true);
});

test("sysctl check: live value comparison", async () => {
  const router = (cmd: string): ExecResult => cmd.startsWith("cat '/proc/sys/net/ipv4/ip_forward'") ? ok("1\n") : fail();
  expect(await desired(sysctlModule, { name: "net.ipv4.ip_forward", value: "1" }, router)).toBe(true);
  expect(await desired(sysctlModule, { name: "net.ipv4.ip_forward", value: "0" }, router)).toBe(false);
});

test("mount check: findmnt presence drives desired state", async () => {
  const router = (cmd: string): ExecResult => cmd.startsWith("findmnt") ? ok("/mnt\n") : fail();
  expect(await desired(mountModule, { path: "/mnt", state: "mounted" }, router)).toBe(true);
  expect(await desired(mountModule, { path: "/mnt", state: "unmounted" }, router)).toBe(false);
});

test("known_hosts check: matching line desired, different key not", async () => {
  const router = (cmd: string): ExecResult => cmd.startsWith("cat '/etc/ssh/ssh_known_hosts'") ? ok("github.com ssh-rsa AAAA\n") : fail();
  expect(await desired(knownHostsModule, { name: "github.com", key: "ssh-rsa AAAA" }, router)).toBe(true);
  expect(await desired(knownHostsModule, { name: "github.com", key: "ssh-rsa BBBB" }, router)).toBe(false);
});

test("selinux check: enforcing state comparison", async () => {
  const router = (cmd: string): ExecResult => cmd.startsWith("getenforce") ? ok("Enforcing\n") : fail();
  expect(await desired(selinuxModule, { state: "enforcing" }, router)).toBe(true);
  expect(await desired(selinuxModule, { state: "permissive" }, router)).toBe(false);
});

test("lvol check: same size desired, different size not", async () => {
  const router = (cmd: string): ExecResult => {
    if (cmd.startsWith("lvs 'vg0/lv0'")) return ok();
    if (cmd.includes("lv_size")) return ok("1073741824\n");
    return fail();
  };
  expect(await desired(lvolModule, { vg: "vg0", lv: "lv0", size: "1G" }, router)).toBe(true);
  expect(await desired(lvolModule, { vg: "vg0", lv: "lv0", size: "2G" }, router)).toBe(false);
});

test("firewalld check: query result drives present/absent", async () => {
  const router = (cmd: string): ExecResult => cmd.includes("--query-service=http") ? ok() : fail();
  expect(await desired(firewalldModule, { service: "http" }, router)).toBe(true);
  expect(await desired(firewalldModule, { service: "http", state: "absent" }, router)).toBe(false);
});

test("iptables check: -C result drives present/absent", async () => {
  const router = (cmd: string): ExecResult => cmd.startsWith("iptables -C") ? ok() : fail();
  expect(await desired(iptablesModule, { chain: "INPUT", protocol: "tcp", destination_port: "22", jump: "ACCEPT" }, router)).toBe(true);
  expect(await desired(iptablesModule, { chain: "INPUT", protocol: "tcp", destination_port: "22", jump: "ACCEPT", state: "absent" }, router)).toBe(false);
});

test("ufw check: active state and existing rule", async () => {
  const router = (cmd: string): ExecResult => {
    if (cmd.startsWith("ufw status")) {
      return ok("Status: active\n\nTo                         Action      From\n--                         ------      ----\n22/tcp                     ALLOW       Anywhere\n");
    }
    return fail();
  };
  expect(await desired(ufwModule, { state: "enabled" }, router)).toBe(true);
  expect(await desired(ufwModule, { state: "disabled" }, router)).toBe(false);
  expect(await desired(ufwModule, { rule: "allow", port: "22", proto: "tcp" }, router)).toBe(true);
  expect(await desired(ufwModule, { rule: "allow", port: "443", proto: "tcp" }, router)).toBe(false);
});

test("parted / filesystem / acl checks report observed truth", async () => {
  const partedRouter = (cmd: string): ExecResult => cmd.includes("parted -m") ? ok("1:1049kB:100%\n") : fail();
  expect(await desired(partedModule, { device: "/dev/sdb", number: 1 }, partedRouter)).toBe(true);
  expect(await desired(partedModule, { device: "/dev/sdb", number: 1, state: "absent" }, partedRouter)).toBe(false);

  const fsRouter = (cmd: string): ExecResult => cmd.startsWith("blkid") ? ok("ext4\n") : fail();
  expect(await desired(filesystemModule, { fstype: "ext4", dev: "/dev/sdb1" }, fsRouter)).toBe(true);
  expect(await desired(filesystemModule, { fstype: "xfs", dev: "/dev/sdb1" }, fsRouter)).toBe(false);

  const aclRouter = (cmd: string): ExecResult => cmd.startsWith("getfacl") ? ok("user:deploy:rwx\n") : fail();
  expect(await desired(aclModule, { path: "/srv", entity: "deploy", permissions: "rwx" }, aclRouter)).toBe(true);
  expect(await desired(aclModule, { path: "/srv", entity: "deploy", permissions: "r-x" }, aclRouter)).toBe(false);
});
