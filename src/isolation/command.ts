// Command builders for the isolation backends. These are pure functions so they
// can be unit-tested without bwrap/Docker and reused by LocalConnection.

import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import type { IsolationCommand, IsolationMount } from "./types";

const SYSTEM_PATHS = ["/usr", "/lib", "/lib64", "/bin", "/sbin", "/etc"];

export interface BuildIsolationCommandOptions {
  shell: string;
  command: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  projectRoot: string;
  network: "off" | "on";
  mounts?: IsolationMount[];
  image?: string;
  uid?: number;
  gid?: number;
  /** Override for tests; defaults to the host's existing system paths. */
  systemPaths?: string[];
  /** Egress broker/shim wiring for the sandbox (namespace backend). */
  egress?: {
    /** Host directory containing the broker Unix socket. */
    socketDir: string;
    /** Shim command to launch inside the sandbox. */
    shim: { file: string; args: string[] };
    /** Files to bind into the sandbox (runtime, CLI script, or binary). */
    binds?: Array<{ source: string; target: string }>;
    /** Loopback port the shim listens on inside the sandbox. */
    proxyPort: number;
  };
}

function minimalEnv(env: Record<string, string | undefined> | undefined): Record<string, string> {
  const out: Record<string, string> = {
    PATH: env?.["PATH"] ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    HOME: "/tmp",
    LANG: env?.["LANG"] ?? "C.UTF-8",
  };
  for (const [key, value] of Object.entries(env ?? {})) {
    if (value === undefined) continue;
    if (key === "PATH" || key === "HOME" || key === "LANG") continue;
    // Do not inherit ambient secrets; callers must pass the exact env they need.
    out[key] = value;
  }
  return out;
}

function normalizeCwd(cwd: string | undefined, projectRoot: string): string {
  const root = isAbsolute(projectRoot) ? projectRoot : resolve(projectRoot);
  if (!cwd) return root;
  const abs = isAbsolute(cwd) ? cwd : resolve(root, cwd);
  // A cwd outside the project is not mounted; fall back to the project root.
  return abs === root || abs.startsWith(`${root}/`) ? abs : root;
}

function mountArgs(mounts: IsolationMount[] | undefined): IsolationMount[] {
  return (mounts ?? []).filter((m) => isAbsolute(m.source) && isAbsolute(m.target));
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Build a rootless bubblewrap invocation. */
export function buildNamespaceCommand(opts: BuildIsolationCommandOptions): IsolationCommand {
  const projectRoot = isAbsolute(opts.projectRoot) ? opts.projectRoot : resolve(opts.projectRoot);
  const cwd = normalizeCwd(opts.cwd, projectRoot);
  const env = minimalEnv(opts.env);
  const systemPaths = (opts.systemPaths ?? SYSTEM_PATHS).filter((p) => existsSync(p));

  const args: string[] = [
    "--unshare-user",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
    "--die-with-parent",
    "--new-session",
    "--cap-drop",
    "ALL",
    "--clearenv",
    "--setenv",
    "PATH",
    env["PATH"]!,
    "--setenv",
    "HOME",
    env["HOME"]!,
    "--setenv",
    "LANG",
    env["LANG"]!,
  ];
  if (opts.network === "off") args.push("--unshare-net");

  for (const p of systemPaths) args.push("--ro-bind", p, p);
  args.push("--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp");
  args.push("--bind", projectRoot, projectRoot);

  for (const mount of mountArgs(opts.mounts)) {
    const flag = mount.mode === "ro" ? "--ro-bind" : "--bind";
    args.push(flag, mount.source, mount.target);
  }
  for (const [key, value] of Object.entries(env)) {
    if (key === "PATH" || key === "HOME" || key === "LANG") continue;
    args.push("--setenv", key, value);
  }

  if (opts.egress) {
    args.push("--bind", opts.egress.socketDir, "/run/rolecall-egress");
    for (const bind of opts.egress.binds ?? []) {
      args.push("--ro-bind", bind.source, bind.target);
    }
    const proxy = `http://127.0.0.1:${opts.egress.proxyPort}`;
    args.push(
      "--setenv",
      "ROLECALL_EGRESS_SOCKET",
      "/run/rolecall-egress/egress.sock",
      "--setenv",
      "ROLECALL_EGRESS_LISTEN",
      `127.0.0.1:${opts.egress.proxyPort}`,
      "--setenv",
      "ROLECALL_EGRESS_READY",
      "/run/rolecall-egress/ready",
      "--setenv",
      "ROLECALL_USER_COMMAND",
      opts.command,
      "--setenv",
      "HTTP_PROXY",
      proxy,
      "--setenv",
      "http_proxy",
      proxy,
      "--setenv",
      "HTTPS_PROXY",
      proxy,
      "--setenv",
      "https_proxy",
      proxy,
      "--setenv",
      "ALL_PROXY",
      proxy,
      "--setenv",
      "NO_PROXY",
      "localhost",
    );
    const shim = [opts.egress.shim.file, ...opts.egress.shim.args].map(shQuote).join(" ");
    args.push(
      "--chdir",
      cwd,
      "--",
      opts.shell,
      "-c",
      `ip link set lo up 2>/dev/null; ${shim} & i=0; while [ ! -e /run/rolecall-egress/ready ] && [ "$i" -lt 100 ]; do sleep 0.05; i=$((i+1)); done; exec /bin/sh -c "$ROLECALL_USER_COMMAND"`,
    );
    return { file: "bwrap", args, env };
  }

  args.push("--chdir", cwd, "--", opts.shell, "-c", opts.command);
  return { file: "bwrap", args, env };
}

/** Build a Docker invocation (portable fallback / non-Linux). */
export function buildDockerCommand(opts: BuildIsolationCommandOptions): IsolationCommand {
  const projectRoot = isAbsolute(opts.projectRoot) ? opts.projectRoot : resolve(opts.projectRoot);
  const cwd = normalizeCwd(opts.cwd, projectRoot);
  const env = minimalEnv(opts.env);
  const image = opts.image ?? process.env["ROLECALL_ISOLATION_IMAGE"] ?? "debian:bookworm-slim";

  const args: string[] = [
    "run",
    "--rm",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--tmpfs",
    "/tmp",
    "--network",
    opts.network === "off" ? "none" : "bridge",
    "--workdir",
    cwd,
    "-v",
    `${projectRoot}:${projectRoot}`,
  ];
  if (opts.uid !== undefined && opts.gid !== undefined) {
    args.push("--user", `${opts.uid}:${opts.gid}`);
  }
  for (const mount of mountArgs(opts.mounts)) {
    args.push("-v", `${mount.source}:${mount.target}:${mount.mode}`);
  }
  for (const [key, value] of Object.entries(env)) {
    args.push("-e", `${key}=${value}`);
  }
  args.push(image, opts.shell, "-c", opts.command);
  return { file: "docker", args, env };
}
