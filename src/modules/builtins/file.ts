// Built-in module: `file` (P8) — idempotent directory / regular-file / touch /
// symlink / remove operations plus mode/owner/group application.
//
// Runs entirely through `ctx.connection.exec`, so it works over Local or Ssh
// transports alike. Every operation probes current state before acting and
// reports `changed:false` when the desired state already holds. Attribute edits
// (mode/owner/group) are applied conditionally by reading `stat` output first,
// so an unchanged attribute never triggers a redundant chmod/chown/chgrp.
// Privilege escalation follows the same convention as the other builtins: every
// command is prefixed with `${sudo}` when `become` is requested. Paths are
// single-quoted via shQuote to survive spaces/special characters remotely.

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** Filesystem object kinds this module can manage. */
type FileState = "directory" | "file" | "touch" | "link" | "absent";

interface FileArgs {
  /** Target path on the host. Required. */
  path: string;
  /** Desired state. Required. */
  state: FileState;
  /** Octal mode, e.g. "0755", applied when present. */
  mode?: string;
  /** Owner user name, applied when present. */
  owner?: string;
  /** Group name, applied when present. */
  group?: string;
  /** Link source target; required when state is "link". */
  src?: string;
  /** Recurse into directories when applying attributes or removing. */
  recurse?: boolean;
}

/** Search metadata for the `file` module (auto-collected by builtins/index.ts). */
export const meta: ModuleSummary = {
  name: "file",
  description:
    "Idempotently create/remove directories, files, symlinks, and apply mode/owner/group.",
  idempotent: true,
  source: "builtin",
  args: {
    path: { type: "string", required: true, description: "Target path on the host." },
    state: {
      type: "directory | file | touch | link | absent",
      required: true,
      description: "Desired state of the path.",
    },
    mode: { type: "string", required: false, description: "Octal mode to apply, e.g. '0755'." },
    owner: { type: "string", required: false, description: "Owner user to apply." },
    group: { type: "string", required: false, description: "Group to apply." },
    src: { type: "string", required: false, description: "Link source; required when state is 'link'." },
    recurse: {
      type: "boolean",
      required: false,
      description: "Recurse into directories when applying attributes or removing.",
    },
  },
  examples: [
    `- file:
    path:
      $var: vars.web_root
    state: directory
    mode: '0755'`,
    `- file:
    path: /etc/nginx/conf.d/site.conf
    state: touch
    mode: '0644'`,
  ],
  notes:
    "≠ Ansible `file`: naïve shell implementation using `[ -d ]`/`[ -f ]`/`ln -sfn`/`rm`. No SELinux contexts, ACLs, follow/force semantics for links, backup handling, or remote-user validation. mtime is intentionally NOT updated on existing paths during `touch` (kept strictly idempotent).",
};

async function has(conn: NonNullable<ModuleContext["connection"]>, sudo: string, test: string): Promise<boolean> {
  const res = await conn.exec(`${sudo}${test}`);
  return res.exitCode === 0;
}

async function dirExists(
  conn: NonNullable<ModuleContext["connection"]>,
  sudo: string,
  path: string,
): Promise<boolean> {
  return has(conn, sudo, `[ -d ${shQuote(path)} ]`);
}

async function exists(
  conn: NonNullable<ModuleContext["connection"]>,
  sudo: string,
  path: string,
): Promise<boolean> {
  return has(conn, sudo, `[ -e ${shQuote(path)} ]`);
}

async function isRegularFile(
  conn: NonNullable<ModuleContext["connection"]>,
  sudo: string,
  path: string,
): Promise<boolean> {
  return has(conn, sudo, `[ -f ${shQuote(path)} ]`);
}

/** Probe current mode/owner/group and apply only the attributes that differ. Returns whether anything changed. */
async function applyAttrs(
  conn: NonNullable<ModuleContext["connection"]>,
  sudo: string,
  opts: Pick<FileArgs, "mode" | "owner" | "group" | "recurse"> & { path: string },
): Promise<boolean> {
  const wantsMode = typeof opts.mode === "string" && opts.mode.length > 0;
  const wantsOwner = typeof opts.owner === "string" && opts.owner.length > 0;
  const wantsGroup = typeof opts.group === "string" && opts.group.length > 0;
  if (!wantsMode && !wantsOwner && !wantsGroup) return false;

  const st = await conn.exec(`${sudo}stat -c '%a %U %G' ${shQuote(opts.path)}`);
  if (st.exitCode !== 0) return false;
  const parts = st.stdout.trim().split(/\s+/);
  const curA = parts[0] ?? "";
  const curU = parts[1] ?? "";
  const curG = parts[2] ?? "";
  const rec = opts.recurse ? "-R " : "";
  let changed = false;

  // Compare octally so "0755" and "%a"'s "755" are treated as identical.
  if (wantsMode && opts.mode !== undefined && curA !== opts.mode && Number.parseInt(curA, 8) !== Number.parseInt(opts.mode, 8)) {
    await conn.exec(`${sudo}chmod ${rec}${opts.mode} ${shQuote(opts.path)}`);
    changed = true;
  }
  if (wantsOwner && opts.owner !== undefined && curU !== opts.owner) {
    await conn.exec(`${sudo}chown ${rec}${opts.owner} ${shQuote(opts.path)}`);
    changed = true;
  }
  if (wantsGroup && opts.group !== undefined && curG !== opts.group) {
    await conn.exec(`${sudo}chgrp ${rec}${opts.group} ${shQuote(opts.path)}`);
    changed = true;
  }
  return changed;
}

/** @summary Apply the requested filesystem state at `path` idempotently over the connection's shell. Probes existence before acting so re-runs are no-ops; applies mode/owner/group conditionally. @param ctx ModuleContext carrying FileArgs and connection. @returns ModuleResult with data.path/state populated. */
export const fileModule: Module = {
  name: "file",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const args = ctx.args as unknown as FileArgs;
    const path = String(args.path ?? "");
    if (!path) {
      return { changed: false, failed: true, msg: "file: 'path' is required" };
    }
    const VALID_STATES: readonly FileState[] = ["directory", "file", "touch", "link", "absent"];
    const state: FileState = String(args.state ?? "") as FileState;
    if (!VALID_STATES.includes(state)) {
      return {
        changed: false,
        failed: true,
        msg: `file: 'state' must be one of ${VALID_STATES.join(" | ")}`,
      };
    }
    const conn = ctx.connection;
    const sudo = ctx.become ? "sudo " : "";
    const recurse = args.recurse === true;
    let changed = false;

    switch (state) {
      case "directory": {
        if (!(await dirExists(conn, sudo, path))) {
          await conn.exec(`${sudo}mkdir ${recurse ? "-p " : ""}${shQuote(path)}`);
          changed = true;
        }
        break;
      }
      case "file": {
        if (!(await isRegularFile(conn, sudo, path))) {
          await conn.exec(`${sudo}mkdir -p "$(dirname ${shQuote(path)})" && : > ${shQuote(path)}`);
          changed = true;
        }
        break;
      }
      case "touch": {
        // Idempotent by design: never touch mtime when the entry already exists.
        if (!(await exists(conn, sudo, path))) {
          await conn.exec(`${sudo}touch ${shQuote(path)}`);
          changed = true;
        }
        break;
      }
      case "link": {
        const src = String(args.src ?? "");
        if (!src) {
          return { changed: false, failed: true, msg: "file: 'src' is required for link" };
        }
        const ok = await conn.exec(
          `[ -L ${shQuote(path)} ] && [ "$(readlink ${shQuote(path)})" = ${shQuote(src)} ]`,
        );
        if (ok.exitCode !== 0) {
          await conn.exec(`${sudo}ln -sfn ${shQuote(src)} ${shQuote(path)}`);
          changed = true;
        }
        break;
      }
      case "absent": {
        if (await exists(conn, sudo, path)) {
          await conn.exec(`${sudo}rm ${recurse ? "-r " : ""}${shQuote(path)}`);
          changed = true;
        }
        break;
      }
    }

    if (changed || ["directory", "file", "touch", "link"].includes(state)) {
      if (await applyAttrs(conn, sudo, { path, mode: args.mode, owner: args.owner, group: args.group, recurse })) {
        changed = true;
      }
    }

    return {
      changed,
      stdout: changed ? `${state} ${path}` : `${state} ${path} unchanged`,
      msg: changed ? `${state} ${path} updated` : `${state} ${path} unchanged`,
      data: { path, state },
    };
  },
};

(fileModule as Module & { meta: ModuleSummary }).meta = meta;
