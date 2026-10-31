// Built-in module: `synchronize` — Ansible-parity rsync wrapper.
//
// rsync runs on the CONTROLLER and reaches the target over ssh (`mode: push`
// sends controller -> target, `mode: pull` receives target -> controller). For a
// local target the transfer stays on the controller with no ssh spec. rsync is
// spawned directly (not through the target connection) so idempotency comes from
// `--itemize-changes` output rather than a target-side command.

import { spawnSync } from "node:child_process";

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";

/** Minimal context shape needed to build an rsync plan (a `ModuleContext` satisfies it). */
export interface SynchronizeContextLike {
  /** Resolved host vars; `rolecall_*` keys select the target and its ssh settings. */
  readonly vars?: Record<string, unknown>;
  /** Inventory host name used when `rolecall_host` is absent. */
  readonly host?: string;
  /** Transport connection; `kind: "local"` forces a controller-local transfer. */
  readonly connection?: { readonly kind: string };
}

/** Pure rsync invocation plan produced by {@link buildRsyncPlan}. */
export interface RsyncPlan {
  /** Controller executable to spawn. */
  command: string;
  /** Full argv for {@link RsyncPlan.command}. */
  args: string[];
  /** Direction of the transfer. */
  mode: "push" | "pull";
  /** True when one side of the transfer is a remote ssh target. */
  remote: boolean;
  /** Original source argument (controller path for push, target path for pull). */
  src: string;
  /** Original destination argument (target path for push, controller path for pull). */
  dest: string;
  /** `user@host` for a remote transfer, when applicable. */
  remoteTarget?: string;
}

/** Result shape of a controller-side process spawn, normalized for both runtimes. */
export interface SpawnResultLike {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

/** Injectable controller-side spawn seam (defaults to `node:child_process.spawnSync`). */
export type SpawnLike = (
  command: string,
  args: readonly string[],
  options: { encoding: "utf8"; env?: NodeJS.ProcessEnv },
) => SpawnResultLike;

/** Optional seams used by {@link runSynchronize}; tests inject these to avoid spawning. */
export interface SynchronizeDeps {
  /** Controller process runner (defaults to `spawnSync`). */
  spawn?: SpawnLike;
  /** Binary-availability probe (defaults to `<binary> --version` / `ssh -V`). */
  hasBinary?: (binary: string) => boolean;
}

const defaultSpawn: SpawnLike = (command, args, options) => {
  const result = spawnSync(command, [...args], {
    encoding: "utf8",
    env: options.env ?? process.env,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ...(result.error ? { error: result.error } : {}),
  };
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asPort(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 22;
}

function isLocalTarget(ctxLike: SynchronizeContextLike): boolean {
  const declared = asString(ctxLike.vars?.["rolecall_connection"]);
  if (declared) return declared.toLowerCase() === "local";
  return ctxLike.connection?.kind === "local";
}

function assertKeyAuth(vars: Record<string, unknown>): void {
  const keyFile = asString(vars["rolecall_ssh_private_key_file"]);
  const password = asString(vars["rolecall_ssh_pass"]) ?? asString(vars["rolecall_password"]);
  if (password && !keyFile) {
    throw new Error(
      "synchronize: password-only SSH is not supported for rsync (rsync cannot prompt through the transport); configure key-based auth (e.g. rolecall_ssh_private_key_file) instead of a password",
    );
  }
}

/** Split a shell-ish option string into argv tokens, honoring single/double quotes and backslash escapes. */
function splitOptionString(input: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let started = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i] ?? "";
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === "\\" && quote === '"' && i + 1 < input.length) {
        i += 1;
        current += input[i] ?? "";
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
      continue;
    }
    if (ch === "\\" && i + 1 < input.length) {
      i += 1;
      current += input[i] ?? "";
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started || current.length > 0) {
        out.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += ch;
    started = true;
  }
  if (started || current.length > 0) out.push(current);
  return out;
}

function rsyncOptions(args: Record<string, unknown>): string[] {
  const raw = args["rsync_opts"];
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === "string").flatMap((v) => splitOptionString(v));
  }
  return typeof raw === "string" ? splitOptionString(raw) : [];
}

/**
 * @summary Build the controller-side rsync argv for a `synchronize` invocation without spawning anything.
 * @param args Module arguments (`src`, `dest`, `mode`, `delete`, `recursive`, `rsync_opts`, `check`/`_check`).
 * @param ctxLike Context carrying host vars plus the optional transport kind.
 * @returns A pure {@link RsyncPlan} (command, argv, direction, remote target).
 * @throws Error when required paths are missing, `mode` is invalid, the remote host is unknown, or password-only ssh auth is configured.
 */
export function buildRsyncPlan(
  args: Record<string, unknown>,
  ctxLike: SynchronizeContextLike,
): RsyncPlan {
  const src = asString(args["src"]) ?? "";
  const dest = asString(args["dest"]) ?? "";
  if (!src || !dest) throw new Error("synchronize: 'src' and 'dest' are required");

  const rawMode = asString(args["mode"])?.toLowerCase() ?? "push";
  if (rawMode !== "push" && rawMode !== "pull") {
    throw new Error(`synchronize: unsupported mode '${rawMode}' (expected push or pull)`);
  }
  const mode = rawMode;
  const vars = ctxLike.vars ?? {};
  const remote = !isLocalTarget(ctxLike);
  const recursive = args["recursive"] !== false;
  const del = Boolean(args["delete"]);
  const check = Boolean(args["check"] ?? args["_check"]);

  const argv: string[] = ["--itemize-changes", recursive ? "-a" : "-r"];
  if (del) argv.push("--delete");
  if (check) argv.push("--dry-run");
  argv.push(...rsyncOptions(args));

  let srcArg = src;
  let destArg = dest;
  let remoteTarget: string | undefined;

  if (remote) {
    assertKeyAuth(vars);
    const host = asString(vars["rolecall_host"]) ?? asString(ctxLike.host);
    if (!host) {
      throw new Error("synchronize: cannot determine the remote host; set rolecall_host or run against a resolved inventory host");
    }
    const user =
      asString(vars["rolecall_user"]) ??
      asString(vars["rolecall_ssh_user"]) ??
      process.env["USER"] ??
      process.env["USERNAME"] ??
      "root";
    const port = asPort(vars["rolecall_port"] ?? vars["rolecall_ssh_port"]);
    remoteTarget = `${user}@${host}`;
    const remoteSpec = `${remoteTarget}:${mode === "push" ? dest : src}`;
    if (mode === "push") destArg = remoteSpec;
    else srcArg = remoteSpec;
    argv.push("-e", `ssh -p ${port} -o StrictHostKeyChecking=no`);
  }

  argv.push(srcArg, destArg);
  return {
    command: "rsync",
    args: argv,
    mode,
    remote,
    src,
    dest,
    ...(remoteTarget ? { remoteTarget } : {}),
  };
}

/**
 * @summary Parse rsync `--itemize-changes` stdout, returning true when at least one change was reported.
 * @param stdout Captured rsync stdout.
 * @returns True when any itemized change/deletion line is present.
 */
export function hasItemizedChanges(stdout: string): boolean {
  return stdout.split(/\r?\n/).some((line) => {
    const value = line.trim();
    if (!value) return false;
    return /^[<>ch.]\S{2,}/.test(value) || /^\*deleting\b/.test(value);
  });
}

function probeBinary(spawn: SpawnLike, binary: string): boolean {
  const args = binary === "ssh" ? ["-V"] : ["--version"];
  const result = spawn(binary, args, { encoding: "utf8" });
  return !result.error && result.status === 0;
}

/**
 * @summary Run a `synchronize` invocation on the controller, probing for `rsync`/`ssh` first and reporting changes from rsync's itemized output.
 * @param ctx Module context carrying args, vars, host, and the transport connection.
 * @param deps Optional spawn/binary-probe seams (tests inject these to stay hermetic).
 * @returns ModuleResult; unchanged runs are `changed:false, skipped:true`, and missing binaries/auth failures return actionable messages.
 */
export async function runSynchronize(
  ctx: ModuleContext,
  deps: SynchronizeDeps = {},
): Promise<ModuleResult> {
  const spawn = deps.spawn ?? defaultSpawn;
  const hasBinary = deps.hasBinary ?? ((binary: string) => probeBinary(spawn, binary));

  let plan: RsyncPlan;
  try {
    plan = buildRsyncPlan(ctx.args, ctx);
  } catch (error) {
    return { changed: false, failed: true, msg: error instanceof Error ? error.message : String(error) };
  }

  if (!hasBinary("rsync")) {
    return {
      changed: false,
      failed: true,
      msg: "synchronize: 'rsync' was not found on the controller; install rsync (e.g. `apt-get install rsync` or `brew install rsync`) and retry",
    };
  }
  if (plan.remote && !hasBinary("ssh")) {
    return {
      changed: false,
      failed: true,
      msg: "synchronize: 'ssh' was not found on the controller; install an OpenSSH client or target a local host",
    };
  }

  const result = spawn(plan.command, plan.args, { encoding: "utf8" });
  const stdout = result.stdout;
  const stderr = result.stderr;
  if (result.error || result.status !== 0) {
    const detail =
      stderr.trim() ||
      stdout.trim() ||
      result.error?.message ||
      `exit ${result.status === null ? "without a status" : result.status}`;
    return {
      changed: false,
      failed: true,
      msg: `synchronize: rsync failed: ${detail}`,
      stdout,
      stderr,
      data: { mode: plan.mode, src: plan.src, dest: plan.dest },
    };
  }

  const data = {
    mode: plan.mode,
    src: plan.src,
    dest: plan.dest,
    remote: plan.remote,
    ...(plan.remoteTarget ? { remote_target: plan.remoteTarget } : {}),
  };
  if (!hasItemizedChanges(stdout)) {
    return {
      changed: false,
      skipped: true,
      msg: `synchronize: ${plan.src} -> ${plan.dest} already in sync`,
      stdout,
      stderr,
      data,
    };
  }
  return {
    changed: true,
    msg: `synchronize: ${plan.src} -> ${plan.dest}`,
    stdout,
    stderr,
    data,
  };
}

/** @summary rsync files between the controller and a target (Ansible `synchronize` alternate); rsync runs on the controller. @param ctx ModuleContext carrying `src`, `dest`, `mode`, `delete`, `recursive`, `rsync_opts`, and `check`/`_check`. @returns ModuleResult derived from rsync `--itemize-changes` output. */
export const synchronizeModule: Module = {
  name: "synchronize",
  supportsCheck: true,
  run(ctx: ModuleContext): Promise<ModuleResult> {
    return runSynchronize(ctx);
  },
};

/** Search metadata for the `synchronize` module. */
export const meta: ModuleSummary = {
  name: "synchronize",
  description: "Rsync files between the controller and a target (Ansible `synchronize` alternate); rsync runs on the controller and reaches ssh targets with `-e`.",
  source: "builtin",
  args: {
    src: { type: "string", required: true, description: "Source path (controller path for `push`, target path for `pull`)." },
    dest: { type: "string", required: true, description: "Destination path (target path for `push`, controller path for `pull`)." },
    mode: { type: "string", required: false, description: "Transfer direction: `push` (default, controller -> target) or `pull` (target -> controller)." },
    delete: { type: "boolean", required: false, description: "Mirror deletions on the destination (--delete)." },
    recursive: { type: "boolean", required: false, description: "Recurse (default true; `-a`, or `-r` when false)." },
    rsync_opts: { type: "string", required: false, description: "Extra rsync options, whitespace-separated (quotes supported)." },
    check: { type: "boolean", required: false, description: "Dry run: add `--dry-run` (the global `--check` passthrough sets `_check`)." },
  },
  examples: [
    `- synchronize:
    src: /srv/www/
    dest: /var/www/
    delete: true`,
    `- synchronize:
    mode: pull
    src: /var/log/app.log
    dest: /tmp/collected/
    rsync_opts: --compress`,
  ],
  notes: "Ansible-parity: rsync runs on the controller, not the target. Default `mode: push` sends a controller `src` to a target `dest`; `mode: pull` reverses it. Local targets (`rolecall_connection: local`) rsync locally with no ssh spec. SSH targets use `user@host:path` plus `-e \"ssh -p <port> -o StrictHostKeyChecking=no\"` from `rolecall_user`/`rolecall_ssh_user`, `rolecall_host`, and `rolecall_port`/`rolecall_ssh_port`. Key-based auth is required: password-only ssh cannot prompt through rsync, so it fails with an actionable error (no `sshpass`). Idempotency uses `--itemize-changes`; no output means `changed: false, skipped: true`.",
};

(synchronizeModule as Module & { meta: ModuleSummary }).meta = meta;
export default synchronizeModule;
