// ADR 0025 core slice: isolation command builders + probe selection.
// No bwrap/Docker execution is required; probe dependencies are injected.

import { expect, test } from "bun:test";
import {
  buildDockerCommand,
  buildNamespaceCommand,
  probeIsolation,
  type ProbeDeps,
} from "../src/isolation";
import { parseMounts } from "../src/cli/parse-mounts";
import { getUrlModule } from "../src/modules/builtins/get_url";
import { gitModule } from "../src/modules/builtins/git";
import { commandModule } from "../src/modules/builtins/command";

function deps(overrides: Partial<ProbeDeps>): ProbeDeps {
  return {
    platform: "linux",
    which: () => false,
    run: () => ({ status: 1 }),
    env: {},
    ...overrides,
  };
}

test("namespace builder locks down the shell and binds the project", () => {
  const cmd = buildNamespaceCommand({
    shell: "/bin/sh",
    command: "echo hi",
    projectRoot: "/work",
    network: "off",
    systemPaths: [],
  });
  expect(cmd.file).toBe("bwrap");
  expect(cmd.args).toContain("--unshare-user");
  expect(cmd.args).toContain("--unshare-net");
  expect(cmd.args).toContain("--die-with-parent");
  expect(cmd.args).toContain("--cap-drop");
  expect(cmd.args).toContain("ALL");
  expect(cmd.args).toEqual(expect.arrayContaining(["--bind", "/work", "/work"]));
  expect(cmd.args).toEqual(expect.arrayContaining(["--chdir", "/work", "--", "/bin/sh", "-c", "echo hi"]));
});

test("namespace builder keeps networking when explicitly enabled", () => {
  const cmd = buildNamespaceCommand({
    shell: "/bin/sh",
    command: "true",
    projectRoot: "/work",
    network: "on",
    systemPaths: [],
  });
  expect(cmd.args).not.toContain("--unshare-net");
});

test("docker builder uses no network, read-only root, and the project mount", () => {
  const cmd = buildDockerCommand({
    shell: "/bin/sh",
    command: "echo hi",
    projectRoot: "/work",
    network: "off",
    image: "rolecall/isolation@sha256:abc",
    uid: 1000,
    gid: 1000,
  });
  expect(cmd.file).toBe("docker");
  expect(cmd.args).toEqual(expect.arrayContaining(["--network", "none"]));
  expect(cmd.args).toEqual(expect.arrayContaining(["--read-only", "--cap-drop", "ALL"]));
  expect(cmd.args).toEqual(expect.arrayContaining(["-v", "/work:/work"]));
  expect(cmd.args).toEqual(expect.arrayContaining(["--user", "1000:1000"]));
  expect(cmd.args).toContain("rolecall/isolation@sha256:abc");
});

test("probe auto selects namespace when bwrap userns works", () => {
  const probe = probeIsolation({
    backend: "auto",
    deps: deps({
      which: (cmd) => cmd === "bwrap",
      run: (_cmd, args) => ({ status: args[0] === "--unshare-user" ? 0 : 1 }),
    }),
  });
  expect(probe.selected).toBe("namespace");
  expect(probe.userns).toBe(true);
});

test("probe auto falls back to docker, then none", () => {
  const docker = probeIsolation({
    backend: "auto",
    deps: deps({
      which: (cmd) => cmd === "docker",
      run: (_cmd, args) => ({ status: args[0] === "info" ? 0 : 1, stdout: '["name=seccomp"]' }),
    }),
  });
  expect(docker.selected).toBe("docker");

  const none = probeIsolation({ backend: "auto", deps: deps({}) });
  expect(none.selected).toBe("none");
  expect(none.warnings.length).toBeGreaterThan(0);
});

test("explicit namespace warns when bwrap is missing", () => {
  const probe = probeIsolation({ backend: "namespace", deps: deps({}) });
  expect(probe.selected).toBe("namespace");
  expect(probe.warnings.join(" ")).toContain("bwrap is not installed");
});

test("docker image pinning is surfaced", () => {
  const probe = probeIsolation({
    backend: "docker",
    deps: deps({
      which: (cmd) => cmd === "docker",
      run: () => ({ status: 0, stdout: '["name=rootless"]' }),
    }),
  });
  expect(probe.dockerRootless).toBe(true);
  expect(probe.warnings.join(" ")).toContain("not digest-pinned");
});

test("parseMounts validates absolute source/target and mode", () => {
  expect(parseMounts(["/srv/certs:/mnt/certs:rw", "/data:/mnt/data"])).toEqual([
    { source: "/srv/certs", target: "/mnt/certs", mode: "rw" },
    { source: "/data", target: "/mnt/data", mode: "ro" },
  ]);
  expect(() => parseMounts(["relative:/mnt"])).toThrow(/absolute/);
  expect(() => parseMounts(["/src"])).toThrow(/src:dst/);
});

test("trusted network modules declare the ADR 0025 capability", () => {
  expect(getUrlModule.network).toBe(true);
  expect(gitModule.network).toBe(true);
  expect(commandModule.network).toBeUndefined();
});

test("the executor tags module exec with the right ADR 0025 profile", async () => {
  const { registerModule, runPlaybook } = await import("../src/executor");
  const { createNoopConnection } = await import("../src/executor/context");
  const seen: Array<string | undefined> = [];
  const base = createNoopConnection();
  const conn = {
    ...base,
    exec: async (_cmd: string, opts?: import("../src/transport/connection").ExecOptions) => {
      seen.push(opts?.profile);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };
  registerModule({
    name: "__profile_net",
    network: true,
    run: async (ctx) => {
      await ctx.connection.exec("true");
      return { changed: false };
    },
  });
  registerModule({
    name: "__profile_plain",
    run: async (ctx) => {
      await ctx.connection.exec("true");
      return { changed: false };
    },
  });
  const inv = { groups: { all: { hosts: ["h1"], vars: {} } } };
  const pb = (module: string) => [{ hosts: ["all"], vars: {}, tasks: [{ name: "t", module, args: {}, notify: [] }] }];
  await runPlaybook(pb("__profile_net") as never, inv as never, { connectionFor: () => conn as never });
  await runPlaybook(pb("__profile_plain") as never, inv as never, { connectionFor: () => conn as never });
  expect(seen).toEqual(["networked", "untrusted"]);
});
