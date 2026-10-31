// Built-in module: `user` (P9) — imperative probe-and-write idempotency for
// local/unix accounts, mirroring Ansible's `user` semantics over Local or Ssh.
//
// Every operation probes current state before acting and reports `changed:false`
// when the desired state already holds. Existence + identity attributes (uid/gid/
// home/shell) come from a single `getent passwd <name>` read; supplementary groups
// are reconciled against `groups <name>`. Creation runs `useradd`; drift is fixed
// with `usermod`; removal runs `userdel` (+ `-r` when requested). Privilege
// escalation follows the same convention as the other builtins: every command is
// prefixed with `${sudo}` when `ctx.become` is set — user/group operations are
// inherently privileged on Linux/Unix hosts. Args are single-quoted via shQuote so
// spaces/special characters survive remotely. Cleartext passwords (when provided) are
// applied through `chpasswd`, which accepts a `name:password` line; an already-crypted
// `password_hash` is applied verbatim via `usermod -p` after reading the current shadow
// entry so a matching hash stays a no-op.

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { CheckableModule } from "../../idempotency";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** Desired arguments accepted by the `user` module. */
export interface UserArgs {
  /** Account/login name. Required. */
  name: string;
  /** Ensure the account exists ("present", default) or remove it ("absent"). */
  state?: "present" | "absent";
  /** Numeric UID to enforce at creation/reconcile time. */
  uid?: number;
  /** Numeric GID to enforce (also sets primary group at creation). */
  gid?: number;
  /** Group name to resolve into a GID (alternative to `gid`). */
  group?: string;
  /** Login/home directory path. */
  home?: string;
  /** Login shell path. */
  shell?: string;
  /** Create the home directory at creation time (default true unless explicitly false). */
  create_home?: boolean;
  /** Comma-separated list of supplementary groups to apply. */
  groups?: string;
  /** Append `groups` to the existing supplementary set instead of replacing it. */
  append?: boolean;
  /** Create a system account (no aging defaults applied). */
  system?: boolean;
  /** Cleartext password applied via `chpasswd` only when provided. */
  password?: string;
  /** Already-crypted password (e.g. `$6$...`) applied verbatim via `usermod -p`. Exclusive with `password`. */
  password_hash?: string;
  /** Remove the account's home directory and mail spool on deletion (`userdel -r`). */
  remove?: boolean;
}

interface PasswdEntry {
  name: string;
  uid?: number;
  gid?: number;
  home?: string;
  shell?: string;
}

/**
 * Read an account from `/etc/passwd` via `getent passwd <name>`. Falls back to
 * `id -u <name>` when `getent` is unavailable so the presence check still works on
 * minimal images. Returns `{ found: false }` when the account does not exist.
 * @param conn Active connection (Local or Ssh).
 * @param sudo Empty string, or `"sudo "` when privilege escalation is requested.
 * @param name Login name to look up.
 * @returns Whether the account exists plus its parsed passwd fields (when present).
 */
async function lookupUser(
  conn: NonNullable<ModuleContext["connection"]>,
  sudo: string,
  name: string,
): Promise<{ found: boolean; entry?: PasswdEntry }> {
  const ge = await conn.exec(`${sudo}getent passwd ${shQuote(name)}`);
  if (ge.exitCode === 0 && ge.stdout.trim().length > 0) {
    const raw = ge.stdout.split("\n")[0] ?? "";
    const p = raw.split(":");
    return {
      found: true,
      entry: {
        name: p[0] ?? "",
        uid: p[2] !== undefined ? Number.parseInt(String(p[2]), 10) : undefined,
        gid: p[3] !== undefined ? Number.parseInt(String(p[3]), 10) : undefined,
        home: p[5] ?? undefined,
        shell: p[6] ?? undefined,
      },
    };
  }
  const idres = await conn.exec(`${sudo}id -u ${shQuote(name)}`);
  return { found: idres.exitCode === 0 };
}

/**
 * Read the account's password hash from `/etc/shadow` via `getent shadow <name>`
 * (field 2). Returns `undefined` when the lookup fails or yields no hash — for
 * example on a non-root connection — so callers treat the current value as unknown
 * and apply the desired hash.
 * @param conn Active connection (Local or Ssh).
 * @param sudo Empty string, or `"sudo "` when privilege escalation is requested.
 * @param name Login name to look up.
 * @returns The current password hash, or `undefined` when unknown.
 */
async function readShadowHash(
  conn: NonNullable<ModuleContext["connection"]>,
  sudo: string,
  name: string,
): Promise<string | undefined> {
  const res = await conn.exec(`${sudo}getent shadow ${shQuote(name)}`);
  if (res.exitCode !== 0) return undefined;
  const raw = res.stdout.split("\n")[0] ?? "";
  if (raw.trim().length === 0) return undefined;
  const hash = raw.split(":")[1];
  return hash !== undefined && hash.length > 0 ? hash : undefined;
}

/** Parse the comma/space separated supplementary groups reported by `groups <name>`. */
function parseGroups(stdout: string): string[] {
  // Real output looks like "alice : grpA grpB "; split on ':' then whitespace.
  const afterColon = stdout.includes(":") ? stdout.slice(stdout.indexOf(":") + 1) : stdout;
  return afterColon.trim().split(/\s+/).filter((g) => g.length > 0);
}

/** Build a `useradd` command honoring whichever optional attributes were supplied. */
function buildCreate(args: UserArgs): string[] {
  const parts: string[] = ["useradd"];
  if (args.system === true) parts.push("--system");
  if (typeof args.uid === "number") parts.push(`--uid ${args.uid}`);
  if (typeof args.gid === "number") parts.push(`--gid ${args.gid}`);
  else if (typeof args.group === "string" && args.group.length > 0) parts.push(`--gid ${shQuote(args.group)}`);
  if (typeof args.home === "string" && args.home.length > 0) parts.push(`--home-dir ${shQuote(args.home)}`);
  if (typeof args.shell === "string" && args.shell.length > 0) parts.push(`--shell ${shQuote(args.shell)}`);
  // Default to creating the home directory unless explicitly disabled.
  if (args.create_home !== false) parts.push("--create-home");
  if (typeof args.groups === "string" && args.groups.length > 0) {
    parts.push(args.append === true ? "--append --groups" : "--groups");
    parts.push(shQuote(args.groups));
  }
  parts.push(shQuote(args.name));
  return parts;
}

/** Build a reconciling `usermod` command for every attribute that has drifted. */
function buildReconcile(args: UserArgs, cur: PasswdEntry): string[] {
  const parts: string[] = ["usermod"];
  let applied = false;

  if (typeof args.uid === "number" && args.uid !== cur.uid) {
    parts.push(`--uid ${args.uid}`);
    applied = true;
  }
  if (typeof args.gid === "number" && args.gid !== cur.gid) {
    parts.push(`--gid ${args.gid}`);
    applied = true;
  } else if (
    typeof args.group === "string" &&
    args.group.length > 0 &&
    (cur.gid === undefined || args.gid !== undefined)
  ) {
    // Resolve group→GID only when we can compare against the current GID.
    parts.push(`--gid ${shQuote(args.group)}`);
    applied = true;
  }
  if (typeof args.home === "string" && args.home.length > 0 && args.home !== cur.home) {
    parts.push(`--home-dir ${shQuote(args.home)}`);
    applied = true;
  }
  if (typeof args.shell === "string" && args.shell.length > 0 && args.shell !== cur.shell) {
    parts.push(`--shell ${shQuote(args.shell)}`);
    applied = true;
  }
  if (typeof args.groups === "string" && args.groups.length > 0) {
    parts.push(args.append === true ? "--append --groups" : "--groups");
    parts.push(shQuote(args.groups));
    applied = true;
  }
  return applied ? parts : [];
}

/** Search metadata for the `user` module (auto-collected by builtins/index.ts). */
export const meta: ModuleSummary = {
  name: "user",
  description:
    "Ensure or remove a local/unix account idempotently (present/absent), reconciling uid/gid/home/shell/groups.",
  idempotent: true,
  source: "builtin",
  args: {
    name: { type: "string", required: true, description: "Account/login name. Required." },
    state: {
      type: "present | absent",
      required: false,
      description: "Desired state (default 'present').",
    },
    uid: { type: "number", required: false, description: "Numeric UID to enforce at creation/reconcile." },
    gid: { type: "number", required: false, description: "Numeric GID to enforce (also sets primary group)." },
    group: { type: "string", required: false, description: "Group name resolved into a GID (alternative to gid)." },
    home: { type: "string", required: false, description: "Login/home directory path." },
    shell: { type: "string", required: false, description: "Login shell path." },
    create_home: {
      type: "boolean",
      required: false,
      description: "Create the home directory at creation time (default true unless explicitly false).",
    },
    groups: {
      type: "string",
      required: false,
      description: "Comma-separated supplementary groups. Use append to merge instead of replace.",
    },
    append: {
      type: "boolean",
      required: false,
      description: "Append groups to the existing set instead of replacing it.",
    },
    system: { type: "boolean", required: false, description: "Create a system account." },
    password: { type: "string", required: false, description: "Cleartext password applied via chpasswd when provided." },
    password_hash: {
      type: "string",
      required: false,
      description: "Already-crypted password (e.g. $6$...) applied verbatim via usermod -p. Exclusive with password.",
    },
    remove: { type: "boolean", required: false, description: "Delete home dir + mail spool on removal (userdel -r)." },
  },
  examples: [
    `- user:
    name: alice
    state: present
    uid: 1050
    shell: /usr/bin/fish`,
    `- user:
    name: deploy
    state: absent
    remove: true`,
  ],
  notes:
    "≠ Ansible `user`: imperative getent-based implementation using useradd/usermod/userdel/chpasswd over Local/Ssh. `password` is sent in cleartext via chpasswd (no hashing); `password_hash` applies an already-crypted value verbatim via usermod -p (compared against the current shadow entry so a matching hash is a no-op). No login-history validation and no OpenSSH/LDAP account backends.",
};

/** @summary Ensure or remove a local/unix account named `name`, reconciling identity attributes idempotently. Probes `/etc/passwd` before acting so re-runs are no-ops; applies `sudo` on every command when `ctx.become` is set. @param ctx ModuleContext carrying UserArgs and connection. @returns ModuleResult with data.name/state populated; failed:true carries the reason in msg on validation/command errors. */
export const userModule: Module & CheckableModule = {
  name: "user",
  async check(args, ctx) {
    const a = args as unknown as UserArgs;
    const name = String(a.name ?? "");
    const state = (a.state ?? "present") as "present" | "absent";
    const conn = ctx.connection;
    const sudo = ctx.become ? "sudo " : "";
    const { found, entry } = await lookupUser(conn, sudo, name);
    if (state === "absent") return { current: { found }, inDesired: !found };
    if (!found) return { current: { found }, inDesired: false };
    let inDesired = buildReconcile({ ...a, groups: undefined }, entry!).length === 0;
    if (inDesired && typeof a.groups === "string" && a.groups.length > 0) {
      const curGroupsRaw = await conn.exec(`${sudo}groups ${shQuote(name)}`);
      if (curGroupsRaw.exitCode === 0) {
        const desired = a.groups.split(",").map((g) => g.trim()).filter((g) => g.length > 0);
        const current = parseGroups(curGroupsRaw.stdout);
        const hasAll = desired.every((g) => current.includes(g));
        const hasExtra = current.some((g) => !new Set(desired).has(g));
        inDesired = a.append === true ? hasAll : hasAll && !hasExtra;
      }
    }
    if (inDesired && typeof a.password_hash === "string" && a.password_hash.length > 0) {
      inDesired = (await readShadowHash(conn, sudo, name)) === a.password_hash;
    }
    if (inDesired && typeof a.password === "string" && a.password.length > 0) {
      // Cleartext passwords are always re-applied (no readback comparison).
      inDesired = false;
    }
    return { current: entry, inDesired };
  },
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const args = ctx.args as unknown as UserArgs;
    const name = String(args.name ?? "");
    if (!name) {
      return { changed: false, failed: true, msg: "user: 'name' is required" };
    }
    const VALID_STATES: readonly ("present" | "absent")[] = ["present", "absent"];
    const state: "present" | "absent" = String(args.state ?? "present") as "present" | "absent";
    if (!VALID_STATES.includes(state)) {
      return {
        changed: false,
        failed: true,
        msg: `user: 'state' must be one of ${VALID_STATES.join(" | ")}`,
      };
    }

    const hasPassword = typeof args.password === "string" && args.password.length > 0;
    const hasPasswordHash = typeof args.password_hash === "string" && args.password_hash.length > 0;
    if (state === "present" && hasPassword && hasPasswordHash) {
      return { changed: false, failed: true, msg: "user: use only one of password / password_hash" };
    }

    const conn = ctx.connection;
    const sudo = ctx.become ? "sudo " : "";
    let changed = false;
    const data: Record<string, unknown> = { name, state };

    if (state === "absent") {
      const { found } = await lookupUser(conn, sudo, name);
      if (!found) {
        return {
          changed: false,
          stdout: `user ${name} already absent`,
          msg: `user ${name} unchanged`,
          data,
        };
      }
      const cmd = `${sudo}userdel${args.remove === true ? " -r" : ""} ${shQuote(name)}`;
      const res = await conn.exec(cmd);
      if (res.exitCode !== 0) {
        return {
          changed: false,
          failed: true,
          stderr: res.stderr || "",
          msg: `user: failed to delete ${name}: ${res.stderr.trim() || `exit ${res.exitCode}`}`,
          data,
        };
      }
      changed = true;
      data.deletedHome = args.remove === true;
      return {
        changed: true,
        stdout: `deleted ${name}${args.remove === true ? " (-r)" : ""}`,
        msg: `user ${name} removed`,
        data,
      };
    }

    // present — ensure the account exists, then reconcile drift
    const { found, entry } = await lookupUser(conn, sudo, name);
    if (!found) {
      const createCmd = buildCreate(args);
      const res = await conn.exec(`${sudo}${createCmd.join(" ")}`);
      if (res.exitCode !== 0) {
        return {
          changed: false,
          failed: true,
          stderr: res.stderr || "",
          msg: `user: failed to create ${name}: ${res.stderr.trim() || `exit ${res.exitCode}`}`,
          data,
        };
      }
      changed = true;
      data.created = true;
    } else {
      const mods = buildReconcile(args, entry!);
      if (mods.length > 0) {
        const res = await conn.exec(`${sudo}${mods.join(" ")}`);
        if (res.exitCode !== 0) {
          return {
            changed: false,
            failed: true,
            stderr: res.stderr || "",
            msg: `user: failed to reconcile ${name}: ${res.stderr.trim() || `exit ${res.exitCode}`}`,
            data,
          };
        }
        changed = true;
        data.reconciled = true;
      }
    }

    // Supplementary-group reconciliation requires reading current groups first.
    if (typeof args.groups === "string" && args.groups.length > 0) {
      const curGroupsRaw = await conn.exec(`${sudo}groups ${shQuote(name)}`);
      if (curGroupsRaw.exitCode === 0) {
        const desired = args.groups.split(",").map((g) => g.trim()).filter((g) => g.length > 0);
        const current = parseGroups(curGroupsRaw.stdout);
        const wantSet = new Set(desired);
        const hasAll = desired.every((g) => current.includes(g));
        const hasExtra = current.some((g) => !wantSet.has(g));
        const append = args.append === true;
        const needsGroupSync = append ? !hasAll : !(hasAll && !hasExtra);
        if (needsGroupSync) {
          const parts = [append ? "--append --groups" : "--groups", shQuote(args.groups)];
          const res = await conn.exec(`${sudo}usermod ${parts.join(" ")}`);
          if (res.exitCode !== 0) {
            return {
              changed: false,
              failed: true,
              stderr: res.stderr || "",
              msg: `user: failed to sync groups for ${name}: ${res.stderr.trim() || `exit ${res.exitCode}`}`,
              data,
            };
          }
          changed = true;
          data.groupSynced = true;
        }
      }
    }

    const desiredHash =
      typeof args.password_hash === "string" && args.password_hash.length > 0 ? args.password_hash : undefined;
    if (desiredHash !== undefined) {
      const currentHash = await readShadowHash(conn, sudo, name);
      if (currentHash !== desiredHash) {
        const res = await conn.exec(`${sudo}usermod -p ${shQuote(desiredHash)} ${shQuote(name)}`);
        if (res.exitCode !== 0) {
          return {
            changed: false,
            failed: true,
            stderr: res.stderr || "",
            msg: `user: failed to set password hash for ${name}: ${res.stderr.trim() || `exit ${res.exitCode}`}`,
            data,
          };
        }
        changed = true;
        data.passwordChanged = true;
      }
    }

    // Password is applied only when supplied (via chpasswd, which takes cleartext).
    if (typeof args.password === "string" && args.password.length > 0) {
      const line = `${name}:${args.password}`;
      const res = await conn.exec(`echo ${shQuote(line)} | ${sudo}chpasswd`);
      if (res.exitCode !== 0) {
        return {
          changed: false,
          failed: true,
          stderr: res.stderr || "",
          msg: `user: failed to set password for ${name}: ${res.stderr.trim() || `exit ${res.exitCode}`}`,
          data,
        };
      }
      changed = true;
      data.passwordChanged = true;
    }

    return {
      changed,
      stdout: changed ? `applied ${name}` : `${name} unchanged`,
      msg: changed ? `user ${name} updated` : `user ${name} unchanged`,
      data,
    };
  },
};

(userModule as Module & { meta: ModuleSummary }).meta = meta;

export default userModule;
