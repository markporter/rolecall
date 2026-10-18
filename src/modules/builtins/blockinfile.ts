// Batteries-included idempotent `blockinfile` module (Todo 27).
//
// Ensures a marker-delimited block is present (or absent) in a target file.
// Idempotency is intrinsic: `describe` reads the file and reports `inDesired`
// when the block already exists and its body is identical (present state) or is
// already absent (absent state). `converge` only writes when a change is needed
// and short-circuits to `changed:false` when the result is byte-identical.

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { CheckableModule } from "../../idempotency/types";
import { resource } from "../resource";
import { readRemoteFile, writeRemoteFile, writeWithBackupValidate } from "./fs";
import type { ModuleSummary } from "../search";

/** Search metadata for the `blockinfile` module (auto-collected by builtins/index.ts). */
export const meta: ModuleSummary = {
  name: "blockinfile",
  description:
    "Idempotent block-in-file module: inserts/replaces/removes a marker-delimited block only when needed. Supports optional backup and a validate command run on the file after writing.",
  idempotent: true,
  source: "builtin",
  args: {
    path: { type: "string", required: true, description: "Destination path on the target." },
    block: { type: "string", required: true, description: "Block body to insert/ensure (multiline allowed)." },
    marker: {
      type: "string",
      required: false,
      description: "Marker template; {mark} becomes BEGIN <id> / END <id>. Default '# RoleCall BLOCK {mark}'.",
    },
    marker_id: { type: "string", required: false, description: "Id used inside the markers. Default 'block'." },
    state: { type: "present | absent", required: false, description: "Desired state (default present)." },
    insertafter: {
      type: "EOF | START",
      required: false,
      description: "Where to insert when absent (default EOF).",
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
    `- blockinfile:
    path: /etc/hosts
    block: |
      10.0.0.1 host1
      10.0.0.2 host2
    state: present`,
    `- blockinfile:
  loop:
    $each:
      $var: play.hosts
    path: /etc/hosts
    marker_id:
      $var: loop.item
    block:
      $concat:
        - 'host-'
        - $var: loop.item
    state: present`,
  ],
  notes:
    "≠ Ansible `blockinfile`: the marker default is `# RoleCall BLOCK {mark}` (not `# BEGIN/END ANSIBLE MANAGED BLOCK`). Uses `$var` refs, not Jinja `{{ }}`.",
};

interface BlockArgs {
  /** Destination path on the target. Required. */
  path: string;
  /** Block body to insert/ensure (multiline allowed). */
  block: string;
  /** Marker template; `{mark}` becomes `BEGIN <id>` / `END <id>`. Default `# RoleCall BLOCK {mark}`. */
  marker?: string;
  /** Id used inside the markers. Default "block". */
  marker_id?: string;
  /** Desired state: "present" (default) or "absent". */
  state?: "present" | "absent";
  /** Where to insert when absent: "EOF" (default) or "START". */
  insertafter?: "EOF" | "START";
  /** Rotate a timestamped `.bak` (preserving attributes via `cp -p`) before writing. */
  backup?: unknown;
  /** Validation command run against the file after writing; `%s` is replaced with the path. The task fails if it exits non-zero. */
  validate?: string;
}

function markers(a: BlockArgs): { begin: string; end: string } {
  const marker = String(a.marker ?? "# RoleCall BLOCK {mark}");
  const id = String(a.marker_id ?? "block");
  return {
    begin: marker.replace("{mark}", `BEGIN ${id}`),
    end: marker.replace("{mark}", `END ${id}`),
  };
}

function extract(content: string, begin: string, end: string): string | null {
  const bi = content.indexOf(begin);
  if (bi < 0) return null;
  const ei = content.indexOf(end, bi + begin.length);
  if (ei < 0) return null;
  return content.slice(bi + begin.length, ei).replace(/^\n/, "").replace(/\n$/, "");
}

/** @summary Idempotent block-in-file module: inserts/replaces/removes a marker-delimited block only when needed. @param args BlockArgs (path, block, marker, marker_id, state, insertafter, backup, validate). @returns Module & CheckableModule. */
export const blockinfileModule: Module & CheckableModule = resource({
  name: "blockinfile",
  async describe(args, ctx) {
    const a = args as unknown as BlockArgs;
    const path = String(a.path ?? "");
    if (!path) return { current: null, inDesired: false };
    const current = await readRemoteFile(ctx.connection, path, ctx.become);
    const { begin, end } = markers(a);
    const state = a.state ?? "present";
    if (state === "present") {
      const present =
        current !== null && extract(current, begin, end) === String(a.block ?? "");
      return { current: current === null ? null : { present }, inDesired: present };
    }
    const inDesired = current === null || current.indexOf(begin) < 0;
    return { current: current === null ? null : { present: false }, inDesired };
  },
  async converge(args, ctx) {
    const a = args as unknown as BlockArgs;
    const path = String(a.path ?? "");
    if (!path) {
      return { changed: false, failed: true, msg: "blockinfile: 'path' is required" };
    }
    const conn = ctx.connection;
    const bec = Boolean(ctx.become);
    const doBackup = Boolean(a.backup);
    const validateCmd = typeof a.validate === "string" ? a.validate : "";
    const current = await readRemoteFile(conn, path, ctx.become);
    const { begin, end } = markers(a);
    const block = String(a.block ?? "");
    const state = a.state ?? "present";

    if (state === "absent") {
      if (current === null || current.indexOf(begin) < 0) {
        return { changed: false, msg: `${path} block absent (no-op)` };
      }
      const next = removeRegion(current, begin, end);
      const r = await writeWithBackupValidate(conn, path, next, { backup: doBackup, validate: validateCmd, become: bec, existing: current });
      if (r.failed) return { changed: false, failed: true, msg: `blockinfile: ${r.failed}` };
      return { changed: true, msg: `${path} block removed`, data: r.backupFile ? { backup_file: r.backupFile } : undefined };
    }

    // present
    if (current !== null && extract(current, begin, end) === block) {
      return { changed: false, msg: `${path} block unchanged` };
    }
    const next =
      current === null
        ? begin + "\n" + block + "\n" + end + "\n"
        : replaceOrInsert(current, begin, end, block, a.insertafter ?? "EOF");
    const r = await writeWithBackupValidate(conn, path, next, { backup: doBackup, validate: validateCmd, become: bec, existing: current });
    if (r.failed) return { changed: false, failed: true, msg: `blockinfile: ${r.failed}` };
    return { changed: true, msg: `${path} block written`, data: r.backupFile ? { backup_file: r.backupFile } : undefined };
  },
});

(blockinfileModule as Module & CheckableModule & { meta: ModuleSummary }).meta = meta;

function replaceOrInsert(
  content: string,
  begin: string,
  end: string,
  block: string,
  where: "EOF" | "START",
): string {
  const bi = content.indexOf(begin);
  if (bi >= 0) {
    const ei = content.indexOf(end, bi + begin.length);
    if (ei >= 0) {
      return (
        content.slice(0, bi) + begin + "\n" + block + "\n" + content.slice(ei + end.length)
      );
    }
  }
  if (where === "START") {
    return begin + "\n" + block + "\n" + end + "\n" + content.replace(/^\n/, "");
  }
  return content.replace(/\n*$/, "") + "\n" + begin + "\n" + block + "\n" + end + "\n";
}

function removeRegion(content: string, begin: string, end: string): string {
  const bi = content.indexOf(begin);
  if (bi < 0) return content;
  const ei = content.indexOf(end, bi + begin.length);
  if (ei < 0) return content;
  return content.slice(0, bi) + content.slice(ei + end.length).replace(/^\n/, "");
}
