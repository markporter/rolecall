// Built-in module: `stat` (read-only introspection) — mirrors Ansible `stat`.
//
// Inspects a single path on the target host and reports its presence plus basic
// attributes. It NEVER mutates anything: `describe`/probe reads current state and
// `converge` is effectively a no-op, so every invocation returns `changed:false`.
//
// Probe strategy follows the same shell-convention as the other builtins
// (`file.ts`): POSIX `[ -e/-d/-f/-L ]` tests decide existence/kind (these follow
// symlinks, matching Ansible's default `follow: true`), and `stat -c` fills in
// mode/owner/group/size/mtime when available. Every command is prefixed with
// `${sudo}` when `become` is requested and paths are single-quoted via shQuote so
// spaces and special characters survive remotely. Plain shell + structured args
// only — no Jinja `{{ }}` rendering.

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
}

interface StatArgs {
  /** Path on the target to inspect. Required. */
  path: string;
}

/** Search metadata for the `stat` module (auto-collected by builtins/index.ts). */
export const meta: ModuleSummary = {
  name: "stat",
  description: "Read-only: report whether a target path exists and its kind/attributes.",
  source: "builtin",
  args: {
    path: { type: "string", required: true, description: "Path on the target to inspect." },
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
  ],
  notes:
    "≠ Ansible `stat`: read-only probe implemented with POSIX `[ -e/-d/-f/-L ]` tests plus GNU `stat -c`; there is no `follow` toggle (always resolves symlinks), no `checksum`/`md5sum` side effect, no `get_checksum`, and `islnk` reflects whether the entry itself is a symlink while `isdir`/`isfile` describe the resolved target. `mtime` is emitted as an ISO-8601 string rather than Ansible's parsed datetime object.",
};

async function has(
  conn: NonNullable<ModuleContext["connection"]>,
  sudo: string,
  test: string,
): Promise<boolean> {
  const res = await conn.exec(`${sudo}${test}`);
  return res.exitCode === 0;
}

/** @summary Resolve mode/owner/group/size/mtime for `path` via GNU `stat -c`. Returns undefined fields where the probe fails or values are empty. @param conn Active connection (Local or Ssh). @param sudo Privilege-escalation prefix ("sudo " when become, else ""). @param path Absolute path on the target. @returns Parsed attribute record, or all-undefined fields when the probe errors out. */
async function attrs(
  conn: NonNullable<ModuleContext["connection"]>,
  sudo: string,
  path: string,
): Promise<Pick<StatData, "mode" | "owner" | "group" | "size" | "mtime">> {
  const res = await conn.exec(`${sudo}stat -c '%a %U %G %s %Y' ${shQuote(path)}`);
  if (res.exitCode !== 0) {
    return {};
  }
  const parts = res.stdout.trim().split(/\s+/);
  const parseOctal = (v: string | undefined): string | undefined => (v && v.length > 0 ? v : undefined);
  const parseName = (v: string | undefined): string | undefined => (v && v.length > 0 ? v : undefined);
  const parseSize = (v: string | undefined): number | undefined =>
    typeof v === "string" && /^[0-9]+$/.test(v) ? Number.parseInt(v, 10) : undefined;
  const parseMtime = (v: string | undefined): string | undefined =>
    typeof v === "string" && /^[0-9]+$/.test(v)
      ? new Date(Number.parseInt(v, 10) * 1000).toISOString()
      : undefined;
  return {
    mode: parseOctal(parts[0]),
    owner: parseName(parts[1]),
    group: parseName(parts[2]),
    size: parseSize(parts[3]),
    mtime: parseMtime(parts[4]),
  };
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

    // `-e` follows symlinks, so a broken symlink reports not-exists — consistent
    // with Ansible's default follow:true behaviour. The returned objects are inline
    // literals so they satisfy `ModuleResult.data`'s `Record<string, unknown>` shape.
    if (await has(conn, sudo, `[ -e ${shQuote(path)} ]`)) {
      const [isDir, isFile, isLink] = await Promise.all([
        has(conn, sudo, `[ -d ${shQuote(path)} ]`),
        has(conn, sudo, `[ -f ${shQuote(path)} ]`),
        has(conn, sudo, `[ -L ${shQuote(path)} ]`),
      ]);
      const m = await attrs(conn, sudo, path);
      return {
        changed: false,
        stdout: JSON.stringify({
          path,
          exists: true,
          isdir: isDir,
          isfile: isFile,
          islnk: isLink,
          ...m,
        }),
        msg: `${path}: present`,
        data: {
          path,
          exists: true,
          isdir: isDir,
          isfile: isFile,
          islnk: isLink,
          ...m,
        },
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
