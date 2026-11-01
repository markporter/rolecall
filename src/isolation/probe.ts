// Isolation discovery: detect bwrap/userns and Docker, then resolve auto/explicit
// selection. Probe dependencies are injectable so doctor tests do not need the
// real binaries.

import { spawnSync } from "node:child_process";

import type { IsolationBackendName, IsolationProbe } from "./types";

export interface ProbeRunResult {
  status: number | null;
  stdout?: string;
  error?: Error;
}

export interface ProbeDeps {
  platform: string;
  which: (cmd: string) => boolean;
  run: (cmd: string, args: string[], timeoutMs?: number) => ProbeRunResult;
  env: Record<string, string | undefined>;
  uid?: number;
  gid?: number;
}

export interface ProbeOptions {
  backend?: IsolationBackendName;
  image?: string;
  deps?: Partial<ProbeDeps>;
}

const DEFAULT_IMAGE = "debian:bookworm-slim";
const PROBE_TIMEOUT_MS = 4_000;

function hasCommand(cmd: string): boolean {
  const res = spawnSync(cmd, ["--version"], { encoding: "utf8", timeout: PROBE_TIMEOUT_MS });
  return res.error === undefined && res.status === 0;
}

function run(cmd: string, args: string[], timeoutMs = PROBE_TIMEOUT_MS): ProbeRunResult {
  const res = spawnSync(cmd, args, { encoding: "utf8", timeout: timeoutMs });
  return {
    status: res.status,
    stdout: res.stdout ?? "",
    ...(res.error ? { error: res.error } : {}),
  };
}

function defaultDeps(): ProbeDeps {
  return {
    platform: process.platform,
    which: hasCommand,
    run,
    env: process.env as Record<string, string | undefined>,
    ...(typeof process.getuid === "function" ? { uid: process.getuid() } : {}),
    ...(typeof process.getgid === "function" ? { gid: process.getgid() } : {}),
  };
}

/** Probe available isolation backends and resolve the requested/auto selection. */
export function probeIsolation(options: ProbeOptions = {}): IsolationProbe {
  const deps = { ...defaultDeps(), ...(options.deps ?? {}) };
  const requested = options.backend ?? "auto";
  const bwrap = deps.which("bwrap");
  const unshare = deps.which("unshare");
  const dockerCli = deps.which("docker");
  const image = options.image ?? deps.env["ROLECALL_ISOLATION_IMAGE"] ?? DEFAULT_IMAGE;
  const warnings: string[] = [];
  const reasons: string[] = [];

  let userns = false;
  if (bwrap) {
    const probe = deps.run(
      "bwrap",
      ["--unshare-user", "--ro-bind", "/", "/", "--", "/bin/true"],
      PROBE_TIMEOUT_MS,
    );
    userns = probe.status === 0;
    reasons.push(userns ? "bwrap userns probe succeeded" : "bwrap userns probe failed");
  } else {
    reasons.push("bwrap not installed");
  }

  let dockerDaemon = false;
  let dockerRootless: boolean | undefined;
  if (dockerCli) {
    const info = deps.run(
      "docker",
      ["info", "--format", "{{json .SecurityOptions}}"],
      PROBE_TIMEOUT_MS,
    );
    dockerDaemon = info.status === 0;
    if (dockerDaemon) {
      const raw = (info.stdout ?? "").toLowerCase();
      dockerRootless = raw.includes("rootless");
      reasons.push(dockerRootless ? "rootless Docker daemon reachable" : "Docker daemon reachable");
      if (!dockerRootless) warnings.push("Docker daemon is not rootless; daemon access is root-equivalent");
    } else {
      reasons.push("Docker CLI present but daemon unreachable");
    }
  } else {
    reasons.push("docker not installed");
  }

  if (userns === false && unshare) {
    reasons.push("unshare is present but the namespace backend currently requires bwrap");
  }
  if (dockerCli && !image.includes("@sha256:")) {
    warnings.push(`isolation image '${image}' is not digest-pinned; set ROLECALL_ISOLATION_IMAGE in production`);
  }

  let selected: IsolationBackendName;
  if (requested === "none") {
    selected = "none";
    warnings.push("isolation explicitly disabled; local shell execution is unsandboxed");
  } else if (requested === "namespace") {
    selected = "namespace";
    if (!bwrap) warnings.push("--isolation namespace requested but bwrap is not installed");
    else if (!userns) warnings.push("--isolation namespace requested but the bwrap userns probe failed");
  } else if (requested === "docker") {
    selected = "docker";
    if (!dockerCli) warnings.push("--isolation docker requested but the Docker CLI is not installed");
    else if (!dockerDaemon) warnings.push("--isolation docker requested but the Docker daemon is unreachable");
  } else if (bwrap && userns) {
    selected = "namespace";
    reasons.push("auto selected namespace");
  } else if (dockerCli && dockerDaemon) {
    selected = "docker";
    reasons.push("auto selected docker (namespace unavailable)");
  } else {
    selected = "none";
    reasons.push("auto found no usable backend");
    warnings.push("no isolation backend available; local shell execution would be unsandboxed");
  }

  return {
    platform: deps.platform,
    requested,
    selected,
    bwrap,
    unshare,
    userns,
    dockerCli,
    dockerDaemon,
    ...(dockerRootless !== undefined ? { dockerRootless } : {}),
    image,
    warnings,
    reasons,
  };
}
