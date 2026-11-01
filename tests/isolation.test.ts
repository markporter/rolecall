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

test("namespace builder wires the egress shim and proxy env", () => {
  const cmd = buildNamespaceCommand({
    shell: "/bin/sh",
    command: "curl https://api.example.com",
    projectRoot: "/work",
    network: "off",
    systemPaths: [],
    egress: {
      socketDir: "/tmp/egress",
      shim: { file: "/bin/rolecall", args: ["__egress-shim"] },
      binds: [{ source: "/bin/rolecall", target: "/run/rolecall/rolecall" }],
      proxyPort: 18080,
    },
  });
  expect(cmd.args).toEqual(expect.arrayContaining(["--bind", "/tmp/egress", "/run/rolecall-egress"]));
  expect(cmd.args).toEqual(
    expect.arrayContaining(["--ro-bind", "/bin/rolecall", "/run/rolecall/rolecall"]),
  );
  expect(cmd.args).toEqual(expect.arrayContaining(["--setenv", "HTTP_PROXY", "http://127.0.0.1:18080"]));
  expect(cmd.args).toEqual(expect.arrayContaining(["--setenv", "HTTPS_PROXY", "http://127.0.0.1:18080"]));
  expect(cmd.args).toEqual(expect.arrayContaining(["--setenv", "ROLECALL_USER_COMMAND", "curl https://api.example.com"]));
  expect(cmd.args.at(-1)).toContain('exec /bin/sh -c "$ROLECALL_USER_COMMAND"');
});

test("namespace egress broker allows and denies real local traffic", async () => {
  const probe = probeIsolation({ backend: "namespace" });
  if (probe.selected !== "namespace" || !probe.userns) return; // no bwrap/userns on this host
  const { LocalConnection } = await import("../src/transport/local");
  const server = Bun.serve({ port: 0, fetch: () => new Response("egress-ok") });
  const url = `http://127.0.0.1:${server.port}/`;
  try {
    const allowed = new LocalConnection({
      kind: "local",
      host: "localhost",
      user: "tester",
      isolation: {
        backend: "namespace",
        projectRoot: process.cwd(),
        network: "module",
        egress: [{ host: "127.0.0.1", ports: [server.port], scope: "all" }],
      },
    });
    await allowed.connect();
    const ok = await allowed.exec(`curl -m 5 -fsS ${url}`);
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout).toContain("egress-ok");
    await allowed.disconnect();

    const denied = new LocalConnection({
      kind: "local",
      host: "localhost",
      user: "tester",
      isolation: {
        backend: "namespace",
        projectRoot: process.cwd(),
        network: "module",
        egress: [{ host: "10.0.0.0/8", ports: [server.port], scope: "all" }],
      },
    });
    await denied.connect();
    const blocked = await denied.exec(`curl -m 5 -fsS ${url}`);
    expect(blocked.exitCode).not.toBe(0);
    expect(blocked.stderr).toContain("403");
    await denied.disconnect();
  } finally {
    server.stop(true);
  }
}, 30_000);
