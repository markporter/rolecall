// Built-in module: `pamd` — Ansible `pamd` alternate (manage a PAM service file).
//
// Ensures a single PAM rule line (`type control module_path [arguments]`) exists
// in `/etc/pam.d/<name>`, replacing an existing rule for the same module or
// removing it for `state: absent`. Idempotency is intrinsic via `resource()`.

import type { Module } from "../../executor/module";
import type { CheckableModule } from "../../idempotency/types";
import { resource } from "../resource";
import { readRemoteFile, writeWithBackupValidate } from "./fs";
import type { ModuleSummary } from "../search";

interface PamdArgs {
  /** PAM service name; the file is `<path>/<name>`. Required. */
  name: string;
  /** PAM management group: auth | account | password | session. Required. */
  type: string;
  /** Control flag, e.g. required, requisite, sufficient, optional. Required. */
  control: string;
  /** PAM module path, e.g. `pam_unix.so`. Required. */
  module_path: string;
  /** Extra module arguments (string or list). */
  module_arguments?: string | string[];
  /** Desired state: present (default) or absent. */
  state?: "present" | "absent";
  /** Directory holding PAM service files (default /etc/pam.d). */
  path?: string;
  /** Rotate a timestamped `.bak` before writing. */
  backup?: boolean;
}

function pamdFilePath(a: PamdArgs): string {
  const base = typeof a.path === "string" && a.path.length > 0 ? a.path : "/etc/pam.d";
  return `${base.replace(/\/$/, "")}/${String(a.name ?? "")}`;
}

function moduleArgs(a: PamdArgs): string {
  if (Array.isArray(a.module_arguments)) return a.module_arguments.map(String).join(" ");
  return typeof a.module_arguments === "string" ? a.module_arguments.trim() : "";
}

function desiredLine(a: PamdArgs): string {
  const args = moduleArgs(a);
  return `${String(a.type).trim()} ${String(a.control).trim()} ${String(a.module_path).trim()}${args ? ` ${args}` : ""}`;
}

/** True when a PAM rule line references the requested module (exact path or basename). */
function referencesModule(line: string, modulePath: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return false;
  const fields = trimmed.split(/\s+/);
  return fields.some((f) => f === modulePath || f.endsWith(`/${modulePath}`));
}

function applyRule(current: string | null, a: PamdArgs): string {
  const desired = desiredLine(a);
  const lines = (current ?? "").split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  if ((a.state ?? "present") === "absent") {
    return lines.filter((line) => !referencesModule(line, String(a.module_path))).join("\n");
  }
  let replaced = false;
  const next: string[] = [];
  for (const line of lines) {
    if (referencesModule(line, String(a.module_path))) {
      if (!replaced) {
        next.push(desired);
        replaced = true;
      }
      continue;
    }
    next.push(line);
  }
  if (!replaced) next.push(desired);
  return next.join("\n");
}

/** @summary Ensure or remove one PAM rule in a service file (Ansible `pamd` alternate). @param args PamdArgs (name, type, control, module_path, module_arguments, state, path, backup). @returns Module & CheckableModule. */
export const pamdModule: Module & CheckableModule = resource({
  name: "pamd",
  async describe(args, ctx) {
    const a = args as unknown as PamdArgs;
    if (!a.name || !a.type || !a.control || !a.module_path) {
      return { current: null, inDesired: false };
    }
    const path = pamdFilePath(a);
    const current = await readRemoteFile(ctx.connection, path, Boolean(ctx.become));
    if (current === null) {
      return { current: null, inDesired: (a.state ?? "present") === "absent" };
    }
    const desired = desiredLine(a);
    const matching = current.split(/\r?\n/).filter((line) => referencesModule(line, String(a.module_path)));
    const inDesired =
      (a.state ?? "present") === "absent"
        ? matching.length === 0
        : matching.length === 1 && matching[0]!.trim() === desired;
    return { current: { matching }, inDesired };
  },
  async converge(args, ctx) {
    const a = args as unknown as PamdArgs;
    const path = pamdFilePath(a);
    if (!a.name || !a.type || !a.control || !a.module_path) {
      return { changed: false, failed: true, msg: "pamd: 'name', 'type', 'control', and 'module_path' are required" };
    }
    const current = await readRemoteFile(ctx.connection, path, Boolean(ctx.become));
    const next = applyRule(current, a);
    if (current === next || (current !== null && current.trim() === next.trim())) {
      return { changed: false, msg: `${path} unchanged` };
    }
    const r = await writeWithBackupValidate(ctx.connection, path, next, {
      backup: Boolean(a.backup),
      validate: "",
      become: Boolean(ctx.become),
      existing: current,
    });
    if (r.failed !== undefined) {
      return { changed: false, failed: true, msg: `pamd: ${r.failed}` };
    }
    return {
      changed: true,
      msg: `${path} ${(a.state ?? "present") === "absent" ? "rule removed" : "rule written"}`,
      data: r.backupFile ? { backup_file: r.backupFile } : undefined,
    };
  },
});

/** Search metadata for the `pamd` module. */
export const meta: ModuleSummary = {
  name: "pamd",
  description:
    "Ensure or remove one PAM rule in /etc/pam.d/<service> (Ansible `pamd` alternate).",
  idempotent: true,
  source: "builtin",
  args: {
    name: { type: "string", required: true, description: "PAM service name; the file is `<path>/<name>`." },
    type: { type: "auth | account | password | session", required: true, description: "PAM management group." },
    control: { type: "string", required: true, description: "Control flag (required/requisite/sufficient/optional)." },
    module_path: { type: "string", required: true, description: "PAM module path, e.g. `pam_unix.so`." },
    module_arguments: { type: "string | string[]", required: false, description: "Extra module arguments." },
    state: { type: "present | absent", required: false, description: "Desired state (default present)." },
    path: { type: "string", required: false, description: "PAM service directory (default /etc/pam.d)." },
    backup: { type: "boolean", required: false, description: "Rotate a timestamped `.bak` before writing." },
  },
  examples: [
    `- pamd:
    name: sshd
    type: auth
    control: required
    module_path: pam_unix.so`,
  ],
  notes:
    "≠ Ansible `pamd`: matches a rule by module path (exact or basename), replaces the first match, and inserts at EOF when absent. Supports `state: absent`, `path`, and `backup`; no `comment` line injection.",
};

(pamdModule as Module & CheckableModule & { meta: ModuleSummary }).meta = meta;
export default pamdModule;
