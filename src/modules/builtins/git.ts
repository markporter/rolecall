// Built-in module: `git` (Wave-2 module parity, P11) — imperative clone / update
// over Local or Ssh, mirroring Ansible's `git` semantics. Idempotency is
// commit-based: the current and desired HEAD are compared; a no-op is reported
// when they already match. Beyond clone + checkout, a local checkout can be
// updated via `stash` (shelve dirty changes), `pull` (fetch + merge), or
// `reset` (`--hard` to HEAD or a ref). Privilege escalation follows the same
// convention as the other builtins: every command is prefixed with `${sudo}`
// when `ctx.become` is set.

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** @summary Git clone/update args. @property repo Source repository URL. @property dest Destination directory. @property version Branch/tag/commit to check out. @property update Fetch before checkout (default true). @property pull Run `git pull` (fetch + merge). @property stash Stash dirty changes before pull/checkout/reset. @property reset Reset --hard to HEAD (true) or a ref (string). @property depth Shallow clone depth (commits). @property force Discard local changes (clean + reset --hard) before checkout/pull. @property accept_hostkey Accept the SSH host key automatically. */
export interface GitArgs {
  /** Source repository URL. */
  repo: string;
  /** Destination directory. */
  dest: string;
  /** Branch/tag/commit to check out (optional). */
  version?: string;
  /** Fetch before checkout (default true). */
  update?: unknown;
  /** Run `git pull` (fetch + merge) to update the current branch. */
  pull?: unknown;
  /** Stash local modifications before pull/checkout/reset when the tree is dirty. */
  stash?: unknown;
  /** Reset --hard to HEAD (true) or to a ref (string), discarding working-tree changes. */
  reset?: unknown;
  /** Clone as a bare repository (default false). */
  bare?: boolean;
  /** Shallow clone depth (number of commits); passed as `--depth N` to clone and fetch. */
  depth?: number;
  /** Discard local changes (git clean -ffdx + reset --hard to HEAD) before checkout/pull. */
  force?: unknown;
  /** Accept the remote SSH host key automatically (sets `GIT_SSH_COMMAND='ssh -o StrictHostKeyChecking=no'`). */
  accept_hostkey?: unknown;
  /** Internal: set by `--check` global passthrough. */
  _check?: unknown;
  /** Internal: set by `--check` global passthrough. */
  check?: unknown;
}

const MODULE_NAME = "git";

/** Search metadata for the `git` module (auto-collected by builtins/index.ts). */
export const meta: ModuleSummary = {
  name: MODULE_NAME,
  description:
    "Clone a repository, or update a local checkout via stash/pull/reset/checkout. Idempotent by comparing current and desired HEAD. Supports shallow clone (depth), forced clean (force), and automatic host-key acceptance (accept_hostkey).",
  idempotent: true,
  source: "builtin",
  args: {
    repo: { type: "string", required: true, description: "Source repository URL." },
    dest: { type: "string", required: true, description: "Destination directory." },
    version: { type: "string", required: false, description: "Branch/tag/commit to check out (after fetch)." },
    update: { type: "boolean", required: false, description: "Fetch before checkout (default true)." },
    pull: { type: "boolean", required: false, description: "Run `git pull` (fetch + merge) to update the current branch." },
    stash: { type: "boolean", required: false, description: "Stash local modifications before pull/checkout/reset when the tree is dirty." },
    reset: { type: "boolean | string", required: false, description: "Reset --hard to HEAD (true) or to a ref (string), discarding working-tree changes." },
    bare: { type: "boolean", required: false, description: "Clone as a bare repository." },
    depth: { type: "number", required: false, description: "Shallow clone depth (commits); passed as `--depth N` to clone and fetch." },
    force: { type: "boolean", required: false, description: "Discard local changes (git clean -ffdx + reset --hard to HEAD) before checkout/pull." },
    accept_hostkey: { type: "boolean", required: false, description: "Accept the remote SSH host key automatically (StrictHostKeyChecking=no)." },
  },
  examples: [
    `- git:
    repo: https://github.com/org/repo
    dest: /opt/repo
    version: main`,
    `- git:
    repo: https://github.com/org/repo
    dest: /opt/repo
    pull: true
    stash: true`,
    `- git:
    repo: https://github.com/org/repo
    dest: /opt/repo
    reset: HEAD`,
  ],
  notes:
    "≠ Ansible `git`: local-tracking refs only (remote refs resolve after `fetch --all`); `pull` is a plain `git pull` (fetch + merge), not rebase. `reset: true` resets --hard to the current HEAD (discards uncommitted work); pair with `stash: true` to shelve first.",
};

async function gitExec(
  conn: NonNullable<ModuleContext["connection"]>,
  sudo: string,
  dest: string,
  sub: string,
  sshCmd = "",
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const res = await conn.exec(`${sudo}${sshCmd}git -C ${shQuote(dest)} ${sub}`);
  return { exitCode: res.exitCode ?? 0, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

async function isDirty(
  conn: NonNullable<ModuleContext["connection"]>,
  sudo: string,
  dest: string,
): Promise<boolean> {
  const r = await gitExec(conn, sudo, dest, "status --porcelain");
  return r.exitCode === 0 && r.stdout.trim().length > 0;
}

async function head(
  conn: NonNullable<ModuleContext["connection"]>,
  sudo: string,
  dest: string,
): Promise<string> {
  const r = await gitExec(conn, sudo, dest, "rev-parse HEAD");
  return r.exitCode === 0 ? r.stdout.trim() : "";
}

async function resolveRef(
  conn: NonNullable<ModuleContext["connection"]>,
  sudo: string,
  dest: string,
  ref: string,
): Promise<string> {
  const r = await gitExec(conn, sudo, dest, `rev-parse ${shQuote(ref)}`);
  return r.exitCode === 0 ? r.stdout.trim() : "";
}

/** @summary Clone a repo to the destination, or update a local checkout (stash/pull/reset/checkout) idempotently. @param ctx ModuleContext (connection, args, become). @returns ModuleResult with changed/skipped/failed and data. */
export const gitModule: Module = {
  name: MODULE_NAME,
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const args = ctx.args as unknown as GitArgs;
    const repo = String(args.repo ?? "");
    if (!repo) return { changed: false, failed: true, msg: "git: 'repo' is required" } as ModuleResult;
    const dest = String(args.dest ?? "");
    if (!dest) return { changed: false, failed: true, msg: "git: 'dest' is required" } as ModuleResult;

    const conn = ctx.connection;
    const sudo = ctx.become ? "sudo " : "";
    const checkMode = Boolean(args._check ?? args.check);
    const update = args.update === undefined ? true : Boolean(args.update);
    const pull = Boolean(args.pull);
    const stash = Boolean(args.stash);
    const reset = args.reset;
    const version = typeof args.version === "string" && args.version.length > 0 ? args.version : "";
    const bare = Boolean(args.bare);
    const depth = typeof args.depth === "number" && args.depth > 0 ? Math.floor(args.depth) : 0;
    const force = Boolean(args.force);
    const acceptHostkey = Boolean(args.accept_hostkey);
    const sshCmd = acceptHostkey ? "GIT_SSH_COMMAND='ssh -o StrictHostKeyChecking=no' " : "";
    const sudoSsh = `${sudo}${sshCmd}`;
    const data: Record<string, unknown> = { repo, dest };

    const existsRes = await conn.exec(`${sudo}test -d ${shQuote(dest)}/.git`);
    const exists = existsRes.exitCode === 0;
    if (!exists) {
      if (checkMode)
        return { changed: false, skipped: true, msg: `${dest} would be cloned`, data: { ...data, wouldChange: true } } as ModuleResult;
      const cloneOpts = `${bare ? "--bare " : ""}${depth > 0 ? `--depth ${depth} ` : ""}`;
      const res = await conn.exec(`${sudoSsh}git clone ${cloneOpts}${shQuote(repo)} ${shQuote(dest)}`);
      if (res.exitCode !== 0)
        return { changed: false, failed: true, stderr: res.stderr || "", msg: `git: clone failed: ${res.stderr.trim() || `exit ${res.exitCode}`}`, data } as ModuleResult;
      return { changed: true, msg: `cloned ${repo} -> ${dest}`, data } as ModuleResult;
    }

    if (force && exists) {
      await gitExec(conn, sudoSsh, dest, "clean -ffdx");
      await gitExec(conn, sudoSsh, dest, "reset --hard");
    }

    const dirty = await isDirty(conn, sudoSsh, dest);
    if (stash && dirty) {
      if (checkMode)
        return { changed: false, skipped: true, msg: `${dest} would stash`, data: { ...data, wouldChange: true } } as ModuleResult;
      const sres = await gitExec(conn, sudoSsh, dest, "stash push");
      if (sres.exitCode !== 0)
        return { changed: false, failed: true, stderr: sres.stderr || "", msg: `git: stash failed`, data } as ModuleResult;
      data.stashed = true;
    }

    if (reset !== undefined) {
      const ref = reset === true || reset === "true" ? "HEAD" : String(reset);
      const cur = await head(conn, sudoSsh, dest);
      const resolved = await resolveRef(conn, sudoSsh, dest, ref);
      const wouldChange = reset === true || reset === "true" ? dirty : resolved !== "" && cur !== resolved;
      if (checkMode) {
        if (wouldChange)
          return { changed: false, skipped: true, msg: `${dest} would reset`, data: { ...data, wouldChange: true } } as ModuleResult;
        return { changed: false, skipped: true, msg: `${dest} unchanged`, data } as ModuleResult;
      }
      if (!wouldChange) return { changed: false, skipped: true, msg: `${dest} unchanged`, data } as ModuleResult;
      const rres = await gitExec(conn, sudoSsh, dest, `reset --hard ${shQuote(ref)}`);
      if (rres.exitCode !== 0)
        return { changed: false, failed: true, stderr: rres.stderr || "", msg: `git: reset failed`, data } as ModuleResult;
      return { changed: true, msg: `${dest} reset --hard ${ref}`, data: { ...data, from: cur, to: resolved || ref } } as ModuleResult;
    }

    if (pull) {
      const cur = await head(conn, sudoSsh, dest);
      const pres = await gitExec(conn, sudoSsh, dest, "pull");
      if (pres.exitCode !== 0)
        return { changed: false, failed: true, stderr: pres.stderr || "", msg: `git: pull failed`, data } as ModuleResult;
      const after = await head(conn, sudo, dest);
      const wouldChange = cur !== after;
      if (checkMode) {
        if (wouldChange)
          return { changed: false, skipped: true, msg: `${dest} would pull`, data: { ...data, wouldChange: true } } as ModuleResult;
        return { changed: false, skipped: true, msg: `${dest} up to date`, data } as ModuleResult;
      }
      return {
        changed: wouldChange,
        msg: wouldChange ? `${dest} pulled` : `${dest} up to date`,
        data: { ...data, from: cur, to: after },
      } as ModuleResult;
    }

    if (version) {
      if (update) {
        const fr = await gitExec(conn, sudoSsh, dest, depth > 0 ? `fetch --all --depth ${depth}` : "fetch --all");
        if (fr.exitCode !== 0) return { changed: false, failed: true, stderr: fr.stderr || "", msg: `git: fetch failed`, data } as ModuleResult;
      }
      const cur = await head(conn, sudoSsh, dest);
      const des = await resolveRef(conn, sudoSsh, dest, version);
      const wouldChange = des !== "" && cur !== des;
      if (checkMode) {
        if (wouldChange)
          return { changed: false, skipped: true, msg: `${dest} would change`, data: { ...data, wouldChange: true } } as ModuleResult;
        return { changed: false, skipped: true, msg: `${dest} unchanged`, data } as ModuleResult;
      }
      if (!wouldChange) return { changed: false, skipped: true, msg: `${dest} unchanged`, data } as ModuleResult;
      const co = await conn.exec(
        `${sudo}git -C ${shQuote(dest)} checkout -f ${shQuote(version)} && ${sudo}git -C ${shQuote(dest)} reset --hard ${shQuote(version)}`,
      );
      if (co.exitCode !== 0)
        return { changed: false, failed: true, stderr: co.stderr || "", msg: `git: checkout failed`, data } as ModuleResult;
      return { changed: true, msg: `${dest} -> ${version}`, data: { ...data, from: cur, to: des } } as ModuleResult;
    }

    if (update) {
      await gitExec(conn, sudoSsh, dest, depth > 0 ? `fetch --all --depth ${depth}` : "fetch --all");
    }
    return { changed: false, skipped: true, msg: `${dest} unchanged`, data } as ModuleResult;
  },
};
(gitModule as Module & { meta: ModuleSummary }).meta = meta;
export default gitModule;
