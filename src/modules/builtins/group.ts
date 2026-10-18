// Built-in module: `group` (Wave-2 module parity, P10) — imperative probe-and-write
// idempotency for local/unix groups over Local or Ssh, mirroring Ansible's `group`
// semantics. Every operation probes current state via `getent group <name>` before
// acting and reports `changed:false` when the desired state already holds. Privilege
// escalation follows the same convention as the other builtins: every command is
// prefixed with `${sudo}` when `ctx.become` is set. Group names/ids are single-quoted
// via shQuote so spaces/special characters survive remotely.

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** Desired arguments accepted by the `group` module. */
export interface GroupArgs {
  /** Group name. Required. */
  name: string;
  /** Ensure the group exists ("present", default) or remove it ("absent"). */
  state?: "present" | "absent";
  /** Numeric GID to enforce at creation/reconcile time. */
  gid?: number;
  /** Create a system group (no aging defaults applied). */
  system?: boolean;
  /** Internal: set by `--check` global passthrough. */
  _check?: unknown;
  /** Internal: set by `--check` global passthrough. */
  check?: unknown;
}

interface GroupEntry {
  gid?: number;
}

/** Read a group from `/etc/group` via `getent group <name>`; falls back to `getent`. */
async function lookupGroup(
  conn: NonNullable<ModuleContext["connection"]>,
  sudo: string,
  name: string,
): Promise<{ found: boolean; entry?: GroupEntry }> {
  const ge = await conn.exec(`${sudo}getent group ${shQuote(name)}`);
  if (ge.exitCode === 0 && ge.stdout.trim().length > 0) {
    const p = ge.stdout.split("\n")[0]!.split(":");
    return {
      found: true,
      entry: { gid: p[2] !== undefined ? Number.parseInt(String(p[2]), 10) : undefined },
    };
  }
  return { found: false };
}

/** Search metadata for the `group` module (auto-collected by builtins/index.ts). */
export const meta: ModuleSummary = {
  name: "group",
  description: "Ensure or remove a local/unix group idempotently (present/absent), reconciling GID.",
  idempotent: true,
  source: "builtin",
  args: {
    name: { type: "string", required: true, description: "Group name. Required." },
    state: { type: "present | absent", required: false, description: "Desired state (default 'present')." },
    gid: { type: "number", required: false, description: "Numeric GID to enforce at creation/reconcile." },
    system: { type: "boolean", required: false, description: "Create a system group." },
  },
  examples: [
    `- group:
    name: deploy
    state: present
    gid: 2000`,
    `- group:
    name: legacy
    state: absent`,
  ],
  notes:
    "≠ Ansible `group`: imperative getent-based implementation using groupadd/groupmod/groupdel over Local/Ssh. No WinNT/AD group backends; GID drift is reconciled with groupmod only when a numeric gid is supplied.",
};

/** @summary Ensure or remove a local/unix group named `name`, reconciling GID idempotently. Probes `/etc/group` before acting so re-runs are no-ops; applies `sudo` on every command when `ctx.become` is set. @param ctx ModuleContext carrying GroupArgs and connection. @returns ModuleResult with data.name/state; failed:true carries the reason in msg on validation/command errors. */
export const groupModule: Module = {
  name: "group",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const args = ctx.args as unknown as GroupArgs;
    const name = String(args.name ?? "");
    if (!name) {
      return { changed: false, failed: true, msg: "group: 'name' is required" };
    }
    const VALID_STATES: readonly ("present" | "absent")[] = ["present", "absent"];
    const state: "present" | "absent" = String(args.state ?? "present") as "present" | "absent";
    if (!VALID_STATES.includes(state)) {
      return { changed: false, failed: true, msg: `group: 'state' must be one of ${VALID_STATES.join(" | ")}` };
    }

    const conn = ctx.connection;
    const sudo = ctx.become ? "sudo " : "";
    const checkMode = Boolean(args._check ?? args.check);
    const data: Record<string, unknown> = { name, state };

    if (state === "absent") {
      const { found } = await lookupGroup(conn, sudo, name);
      if (!found) {
        return { changed: false, skipped: true, msg: `group ${name} unchanged`, data };
      }
      if (checkMode) {
        return { changed: false, skipped: true, msg: `group ${name} would be removed`, data: { ...data, wouldChange: true } };
      }
      const res = await conn.exec(`${sudo}groupdel ${shQuote(name)}`);
      if (res.exitCode !== 0) {
        return {
          changed: false,
          failed: true,
          stderr: res.stderr || "",
          msg: `group: failed to delete ${name}: ${res.stderr.trim() || `exit ${res.exitCode}`}`,
          data,
        };
      }
      return { changed: true, msg: `group ${name} removed`, data };
    }

    const { found, entry } = await lookupGroup(conn, sudo, name);
    if (!found) {
      if (checkMode) {
        return { changed: false, skipped: true, msg: `group ${name} would be created`, data: { ...data, wouldChange: true } };
      }
      const parts = ["groupadd"];
      if (args.system === true) parts.push("--system");
      if (typeof args.gid === "number") parts.push(`--gid ${args.gid}`);
      parts.push(shQuote(name));
      const res = await conn.exec(`${sudo}${parts.join(" ")}`);
      if (res.exitCode !== 0) {
        return {
          changed: false,
          failed: true,
          stderr: res.stderr || "",
          msg: `group: failed to create ${name}: ${res.stderr.trim() || `exit ${res.exitCode}`}`,
          data,
        };
      }
      data.created = true;
      return { changed: true, msg: `group ${name} created`, data };
    }

    // Present and exists — reconcile GID drift.
    if (typeof args.gid === "number" && entry?.gid !== args.gid) {
      if (checkMode) {
        return { changed: false, skipped: true, msg: `group ${name} GID would change`, data: { ...data, wouldChange: true } };
      }
      const res = await conn.exec(`${sudo}groupmod --gid ${args.gid} ${shQuote(name)}`);
      if (res.exitCode !== 0) {
        return {
          changed: false,
          failed: true,
          stderr: res.stderr || "",
          msg: `group: failed to reconcile ${name}: ${res.stderr.trim() || `exit ${res.exitCode}`}`,
          data,
        };
      }
      data.gidChanged = true;
      return { changed: true, msg: `group ${name} updated`, data };
    }

    return { changed: false, skipped: true, msg: `group ${name} unchanged`, data };
  },
};

(groupModule as Module & { meta: ModuleSummary }).meta = meta;

export default groupModule;
