// Batteries-included idempotent `lineinfile` module (Todo 27).
//
// Ensures a single line is present (or absent) in a target file. When `regexp` is
// supplied, an existing matching line is replaced with the desired `line`;
// otherwise the line is appended (or removed). Idempotency is intrinsic:
// `describe` reports `inDesired` when the exact line already exists (present) or
// no matching line exists (absent). `converge` only writes when a change is
// needed and short-circuits to `changed:false` when the content is unchanged.

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { CheckableModule } from "../../idempotency/types";
import { resource } from "../resource";
import { readRemoteFile, writeRemoteFile, writeWithBackupValidate } from "./fs";
import type { ModuleSummary } from "../search";

/** Search metadata for the `lineinfile` module (auto-collected by builtins/index.ts). */
export const meta: ModuleSummary = {
  name: "lineinfile",
  description:
    "Idempotent line-in-file module: ensures a line is present/absent, replacing a regexp-matched line when given. Supports optional backup and a validate command run on the file after writing.",
  idempotent: true,
  source: "builtin",
  args: {
    path: { type: "string", required: true, description: "Destination path on the target." },
    line: { type: "string", required: false, description: "Desired line content (required for present state)." },
    regexp: {
      type: "string",
      required: false,
      description: "Optional regexp matching an existing line to replace.",
    },
    state: { type: "present | absent", required: false, description: "Desired state (default present)." },
    insertafter: {
      type: "string",
      required: false,
      description: "Insert position when absent: `EOF` to append, or a regex string to insert after the last matching line. Default EOF.",
    },
    insertbefore: {
      type: "string",
      required: false,
      description: "Insert position when absent: `BOF`/`START` to prepend, or a regex string to insert before the last matching line. Mutually exclusive with `insertafter`.",
    },
    backup: {
      type: "boolean",
      required: false,
      description: "Back up the existing file (a timestamped `.bak` sibling, attributes preserved) before writing. Defaults to false.",
    },
    validate: {
      type: "string",
      required: false,
      description: "Validation command run against the file after writing; `%s` is replaced with the file path. The task fails if the command exits non-zero (e.g. `nginx -t -c %s`).",
    },
  },
  examples: [
    `- lineinfile:
    path: /etc/resolv.conf
    regexp: '^nameserver\\s+'
    line:
      $concat:
        - 'nameserver '
        - $var: vars.resolver_ip
    state: present`,
  ],
  notes:
    "≠ Ansible `lineinfile`: `insertafter` accepts `EOF` or a regex string; `insertbefore` accepts `BOF`/`START` or a regex string. Regex anchors insert relative to the LAST matching line, falling back to EOF. Uses `$var` refs, not Jinja `{{ }}`.",
};

interface LineArgs {
  /** Destination path on the target. Required. */
  path: string;
  /** Desired line content. Required for present state. */
  line?: string;
  /** Optional regexp matching an existing line to replace. */
  regexp?: string;
  /** Desired state: "present" (default) or "absent". */
  state?: "present" | "absent";
  /** Insert after `"EOF"` or the last line matching a regex string. */
  insertafter?: string;
  /** Insert before `"BOF"`/`"START"` or the last line matching a regex string. */
  insertbefore?: string;
  /** Rotate a timestamped `.bak` (preserving attributes via `cp -p`) before writing. */
  backup?: unknown;
  /** Validation command run against the file after writing; `%s` is replaced with the path. The task fails if it exits non-zero. */
  validate?: string;
}

/** @summary Idempotent line-in-file module: ensures a line is present/absent, replacing a regexp-matched line when given. @param args LineArgs (path, line, regexp, state, insertafter, backup, validate). @returns Module & CheckableModule. */
export const lineinfileModule: Module & CheckableModule = resource({
  name: "lineinfile",
  async describe(args, ctx) {
    const a = args as unknown as LineArgs;
    const path = String(a.path ?? "");
    if (!path) return { current: null, inDesired: false };
    if (hasBothAnchors(a)) return { current: null, inDesired: false };
    const current = await readRemoteFile(ctx.connection, path, Boolean(ctx.become));
    if (current === null) {
      return { current: null, inDesired: (a.state ?? "present") === "absent" };
    }
    const lines = current.split(/\r?\n/);
    const re = a.regexp ? new RegExp(String(a.regexp)) : null;
    const state = a.state ?? "present";
    if (state === "present") {
      const inDesired = lines.some((l) => l === String(a.line ?? ""));
      return { current: { lines: lines.length }, inDesired };
    }
    const inDesired = !lines.some((l) =>
      re ? re.test(l) : l === String(a.line ?? ""),
    );
    return { current: { lines: lines.length }, inDesired };
  },
  async converge(args, ctx) {
    const a = args as unknown as LineArgs;
    const path = String(a.path ?? "");
    if (!path) {
      return { changed: false, failed: true, msg: "lineinfile: 'path' is required" };
    }
    if (hasBothAnchors(a)) {
      return { changed: false, failed: true, msg: "lineinfile: use only one of insertafter / insertbefore" };
    }
    const conn = ctx.connection;
    const bec = Boolean(ctx.become);
    const doBackup = Boolean(a.backup);
    const validateCmd = typeof a.validate === "string" ? a.validate : "";
    const current = await readRemoteFile(conn, path, bec);
    const line = String(a.line ?? "");
    const re = a.regexp ? new RegExp(String(a.regexp)) : null;
    const state = a.state ?? "present";

    if (current === null) {
      if (state === "absent") return { changed: false, msg: `${path} absent (no-op)` };
      const r = await writeWithBackupValidate(conn, path, line + "\n", { backup: doBackup, validate: validateCmd, become: bec, existing: null });
      if (r.failed) return { changed: false, failed: true, msg: `lineinfile: ${r.failed}` };
      return { changed: true, msg: `${path} line added`, data: r.backupFile ? { backup_file: r.backupFile } : undefined };
    }

    const lines = current.split(/\r?\n/);
    // Drop a trailing empty element produced by a final newline.
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

    if (state === "absent") {
      const next = lines.filter((l) => (re ? !re.test(l) : l !== line));
      if (next.length === lines.length) {
        return { changed: false, msg: `${path} line absent (no-op)` };
      }
      const r = await writeWithBackupValidate(conn, path, next.join("\n") + "\n", { backup: doBackup, validate: validateCmd, become: bec, existing: current });
      if (r.failed) return { changed: false, failed: true, msg: `lineinfile: ${r.failed}` };
      return { changed: true, msg: `${path} line removed`, data: r.backupFile ? { backup_file: r.backupFile } : undefined };
    }

    // present
    if (lines.some((l) => l === line)) {
      return { changed: false, msg: `${path} line unchanged` };
    }
    const matchIdx = re ? lines.findIndex((l) => re.test(l)) : -1;
    if (matchIdx >= 0) {
      lines[matchIdx] = line;
    } else if (a.insertbefore === "BOF" || a.insertbefore === "START") {
      lines.unshift(line);
    } else if (a.insertbefore) {
      const beforeIdx = lastMatchIndex(lines, new RegExp(a.insertbefore));
      if (beforeIdx >= 0) lines.splice(beforeIdx, 0, line);
      else lines.push(line);
    } else if (a.insertafter && a.insertafter !== "EOF") {
      const afterIdx = lastMatchIndex(lines, new RegExp(a.insertafter));
      if (afterIdx >= 0) lines.splice(afterIdx + 1, 0, line);
      else lines.push(line);
    } else {
      lines.push(line);
    }
    const r = await writeWithBackupValidate(conn, path, lines.join("\n") + "\n", { backup: doBackup, validate: validateCmd, become: bec, existing: current });
    if (r.failed) return { changed: false, failed: true, msg: `lineinfile: ${r.failed}` };
    return { changed: true, msg: `${path} line added`, data: r.backupFile ? { backup_file: r.backupFile } : undefined };
  },
});

(lineinfileModule as Module & CheckableModule & { meta: ModuleSummary }).meta = meta;

function hasBothAnchors(a: LineArgs): boolean {
  return Boolean(a.insertafter) && Boolean(a.insertbefore);
}

function lastMatchIndex(lines: string[], re: RegExp): number {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (re.test(lines[i]!)) return i;
  }
  return -1;
}
