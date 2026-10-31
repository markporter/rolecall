// Built-in module: `stat` (read-only introspection) — mirrors Ansible `stat`.
//
// Inspects a single path on the target host and reports its presence plus basic
// attributes. It NEVER mutates anything: `describe`/probe reads current state and
// `converge` is effectively a no-op, so every invocation returns `changed:false`.
//
// Probe strategy follows the same shell-convention as the other builtins
// (`file.ts`): POSIX `[ -e/-d/-f/-L ]` tests decide existence/kind when `follow`
// is true (the Ansible default), kind comes from lstat `stat -c '%F'` when
// `follow` is false, and `stat -c` fills in mode/owner/group/size/mtime either
// way (`-L` only under follow). Every command is prefixed with `${sudo}` when
// `become` is requested and paths are single-quoted via shQuote so spaces and
// special characters survive remotely. Plain shell + structured args only — no
// Jinja `{{ }}` rendering.

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** Attributes reported by `stat` for a resolved path. */
interface StatData {
  /** Target path (echoed back from args). */
  path: string;
  /** True when something exists at `path` (symlink-following, like Ansible `follow: true`). */
  exists: boolean;
  /** True when the resolved target is a directory. */
  isdir: boolean;
  /** True when the resolved target is a regular file. */
  isfile: boolean;
  /** True when `path` itself is a symbolic link. */
  islnk: boolean;
  /** Octal permission bits, e.g. "644", when resolvable. */
  mode?: string;
  /** Owning user name, when resolvable. */
  owner?: string;
  /** Owning group name, when resolvable. */
  group?: string;
  /** Size in bytes, when resolvable. */
  size?: number;
  /** Last-modification time as an ISO-8601 string, when resolvable. */
  mtime?: string;
  /** Last-modification time as Unix epoch seconds, when resolvable. */
  mtime_epoch?: number;
  /** Lowercase hex digest of the file contents, when computed. */
  checksum?: string;
}

interface StatArgs {
  /** Path on the target to inspect. Required. */
  path: string;
  /** Resolve symlinks before testing (default true). When false, a broken symlink counts as existing and `stat` runs without `-L`. */
  follow?: boolean;
  /** Checksum algorithm to compute for regular files (`md5`, `sha1`, `sha256`). Implies `get_checksum`. */
  checksum?: "md5" | "sha1" | "sha256";
  /** Compute a checksum (default `sha1`) for regular files even without `checksum`. */
  get_checksum?: boolean;
}

/** Search metadata for the `stat` module (auto-collected by builtins/index.ts). */
export const meta: ModuleSummary = {
  name: "stat",
  description: "Read-only: report whether a target path exists and its kind/attributes.",
  source: "builtin",
  args: {
    path: { type: "string", required: true, description: "Path on the target to inspect." },
    follow: {
      type: "boolean",
      required: false,
      description: "Resolve symlinks before testing (default true); when false a broken symlink counts as present.",
    },
    checksum: {
      type: "md5 | sha1 | sha256",
      required: false,
      description: "Checksum algorithm to compute for regular files.",
    },
    get_checksum: {
      type: "boolean",
      required: false,
      description: "Compute a checksum (default sha1) for regular files.",
    },
  },
  examples: [
    `- stat:
    path: /etc/nginx/nginx.conf
  register: conf_stat`,
    `- stat:
    path:
      $var: vars.web_root
  loop:
    $var: vars.paths_to_check`,
    `- stat:
    path: /etc/app/config.yml
    follow: false
    checksum: sha256
  register: config_stat`,
  ],
  notes:
    "≠ Ansible `stat`: read-only probe implemented with POSIX `[ -e/-d/-f/-L ]` tests plus GNU `stat -c`. `follow` (default true) toggles symlink resolution and the `stat -L` flag; when false a broken symlink counts as existing and kind comes from `stat -c '%F'`. `checksum`/`get_checksum` compute an `md5`/`sha1`/`sha256` digest for regular files. `mtime` is emitted as an ISO-8601 string, with `mtime_epoch` alongside it; `islnk` reflects whether the entry itself is a symlink while `isdir`/`isfile` describe the resolved target (always true under `follow: true`).",
};

async function has(
  conn: NonNullable<ModuleContext["connection"]>,
  sudo: string,
  test: string,
): Promise<boolean> {
  const res = await conn.exec(`${sudo}${test}`);
  return res.exitCode === 0;
}

/** @summary Resolve mode/owner/group/size/mtime for `path` via GNU `stat -c`. Returns undefined fields where the probe fails or values are empty. @param conn Active connection (Local or Ssh). @param sudo Privilege-escalation prefix ("sudo " when become, else ""). @param path Absolute path on the target. @param follow When true, pass `-L` so symlinks are resolved before reading attributes. @returns Parsed attribute record, or all-undefined fields when the probe errors out. */
async function attrs(
  conn: NonNullable<ModuleContext["connection"]>,
  sudo: string,
  path: string,
  follow: boolean,
): Promise<Pick<StatData, "mode" | "owner" | "group" | "size" | "mtime" | "mtime_epoch">> {
  const flag = follow ? "-L " : "";
  const res = await conn.exec(`${sudo}stat ${flag}-c '%a %U %G %s %Y' ${shQuote(path)}`);
  if (res.exitCode !== 0) {
    return {};
  }
  const parts = res.stdout.trim().split(/\s+/);
  const parseOctal = (v: string | undefined): string | undefined => (v && v.length > 0 ? v : undefined);
  const parseName = (v: string | undefined): string | undefined => (v && v.length > 0 ? v : undefined);
  const parseSize = (v: string | undefined): number | undefined =>
    typeof v === "string" && /^[0-9]+$/.test(v) ? Number.parseInt(v, 10) : undefined;
  const parseEpoch = (v: string | undefined): number | undefined =>
    typeof v === "string" && /^[0-9]+$/.test(v) ? Number.parseInt(v, 10) : undefined;
  const parseMtime = (epoch: number | undefined): string | undefined =>
    epoch !== undefined ? new Date(epoch * 1000).toISOString() : undefined;
  const epoch = parseEpoch(parts[4]);
  return {
    mode: parseOctal(parts[0]),
    owner: parseName(parts[1]),
    group: parseName(parts[2]),
    size: parseSize(parts[3]),
    mtime: parseMtime(epoch),
    mtime_epoch: epoch,
  };
}

/** @summary Determine kind (directory/regular file/symlink) from an lstat `stat -c '%F'` probe. Used under `follow:false` where a broken symlink must still be classifiable. @param conn Active connection (Local or Ssh). @param sudo Privilege-escalation prefix. @param path Absolute path on the target. @returns Kind booleans; all false when the probe fails or reports another type. */
async function lstatKind(
  conn: NonNullable<ModuleContext["connection"]>,
  sudo: string,
  path: string,
): Promise<{ isdir: boolean; isfile: boolean; islnk: boolean }> {
  const res = await conn.exec(`${sudo}stat -c '%F' ${shQuote(path)}`);
  if (res.exitCode !== 0) {
    return { isdir: false, isfile: false, islnk: false };
  }
  const t = res.stdout.trim();
  return {
    isdir: t === "directory",
    isfile: t === "regular file" || t === "regular empty file",
    islnk: t === "symbolic link",
  };
}

/** @summary Compute a hex digest of a regular file via `md5sum`/`sha1sum`/`sha256sum`. @param conn Active connection (Local or Ssh). @param sudo Privilege-escalation prefix. @param path Absolute path on the target. @param algo Checksum algorithm to invoke. @returns Lowercase hex digest, or undefined when the command exits non-zero. */
async function fileChecksum(
  conn: NonNullable<ModuleContext["connection"]>,
  sudo: string,
  path: string,
  algo: "md5" | "sha1" | "sha256",
): Promise<string | undefined> {
  const bin = algo === "md5" ? "md5sum" : algo === "sha256" ? "sha256sum" : "sha1sum";
  const res = await conn.exec(`${sudo}${bin} ${shQuote(path)}`);
  if (res.exitCode !== 0) return undefined;
  const first = res.stdout.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : undefined;
}

/** @summary Read-only introspection of a single target path. Probes existence/kind with POSIX tests and fills mode/owner/group/size/mtime from `stat -c`; always returns changed:false because it never mutates host state. @param ctx ModuleContext carrying args (path) and connection. @returns ModuleResult whose data holds the {@link StatData} snapshot. */
export const statModule: Module = {
  name: "stat",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const args = ctx.args as unknown as StatArgs;
    const path = String(args.path ?? "");
    if (!path) {
      return { changed: false, failed: true, msg: "stat: 'path' is required" };
    }
    const conn = ctx.connection;
    const sudo = ctx.become ? "sudo " : "";
    const follow = args.follow !== false;
    const checksumAlgo: "md5" | "sha1" | "sha256" = args.checksum ?? "sha1";
    const wantChecksum = args.checksum !== undefined || args.get_checksum === true;

    // `-e` follows symlinks, so a broken symlink reports not-exists — consistent
    // with Ansible's default follow:true behaviour. Under follow:false, `-L`
    // rescues broken symlinks so they still count as present. The returned objects
    // are inline literals so they satisfy `ModuleResult.data`'s Record shape.
    const present = follow
      ? await has(conn, sudo, `[ -e ${shQuote(path)} ]`)
      : await has(conn, sudo, `[ -e ${shQuote(path)} ] || [ -L ${shQuote(path)} ]`);
    if (present) {
      let isDir: boolean;
      let isFile: boolean;
      let isLink: boolean;
      if (follow) {
        [isDir, isFile, isLink] = await Promise.all([
          has(conn, sudo, `[ -d ${shQuote(path)} ]`),
          has(conn, sudo, `[ -f ${shQuote(path)} ]`),
          has(conn, sudo, `[ -L ${shQuote(path)} ]`),
        ]);
      } else {
        ({ isdir: isDir, isfile: isFile, islnk: isLink } = await lstatKind(conn, sudo, path));
      }
      const m = await attrs(conn, sudo, path, follow);
      const checksum =
        isFile && wantChecksum ? await fileChecksum(conn, sudo, path, checksumAlgo) : undefined;
      const data = {
        path,
        exists: true,
        isdir: isDir,
        isfile: isFile,
        islnk: isLink,
        ...m,
        ...(checksum !== undefined ? { checksum } : {}),
      };
      return {
        changed: false,
        stdout: JSON.stringify(data),
        msg: `${path}: present`,
        data,
      };
    }

    return {
      changed: false,
      stdout: JSON.stringify({ path, exists: false, isdir: false, isfile: false, islnk: false }),
      msg: `${path}: absent`,
      data: { path, exists: false, isdir: false, isfile: false, islnk: false },
    };
  },
};

(statModule as Module & { meta: ModuleSummary }).meta = meta;

// Default export of the same Module (named + default both exported per spec).
export default statModule;
