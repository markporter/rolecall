// Built-in module: `getent` — read entries from the system name-service
// databases (passwd/group/hosts/services/…) without parsing files directly.
//
// The module is read-only (`changed: false`). A non-zero `getent` exit is a
// normal "no matching entries" result and yields an empty `data.getent` array,
// not a task failure; only an unexpected transport error is reported as failed.
// Field names follow the native colon-delimited layouts for the common
// databases, with `field0..fieldN` as a fallback for unknown databases.

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";

const MODULE_NAME = "getent";

/** Standard colon-delimited field names per database (unknown databases fall back to `field0..fieldN`). */
const FIELD_NAMES: Record<string, readonly string[]> = {
  passwd: ["name", "password", "uid", "gid", "gecos", "home", "shell"],
  group: ["name", "password", "gid", "members"],
  hosts: ["ip", "names"],
  services: ["name", "port", "proto", "aliases"],
};

/** @summary Arguments for the `getent` module. @property database Name-service database to query, e.g. `passwd`, `group`, `hosts`, or `services` (required). @property key Optional lookup key; omit to list every entry in the database. */
export interface GetentArgs {
  /** Database name, e.g. "passwd". Required. */
  database: string;
  /** Optional key to look up (e.g. a user, group, host, or service name). */
  key?: string;
}

/** A single parsed `getent` line. */
export interface GetentEntry {
  /** Unmodified output line. */
  raw: string;
  /** Colon-delimited fields mapped to their database-specific names. */
  fields: Record<string, string>;
}

/** Search metadata for the `getent` module (auto-collected by builtins/index.ts). */
export const meta: ModuleSummary = {
  name: MODULE_NAME,
  description:
    "Read entries from a system name-service database (passwd/group/hosts/services/…) and return parsed fields (Ansible `getent` alternate).",
  idempotent: true,
  source: "builtin",
  args: {
    database: {
      type: "string",
      required: true,
      description: "Name-service database, e.g. passwd, group, hosts, or services.",
    },
    key: { type: "string", required: false, description: "Optional lookup key; omit to list all entries." },
  },
  examples: [
    `- getent:
    database: passwd
    key: root`,
    `- getent:
    database: group`,
    `- getent:
    database: hosts
    key: localhost`,
  ],
  notes:
    "≠ Ansible `getent`: returns every requested entry as `{ raw, fields }` rather than a single value/list split by key. `hosts` and `services` accept both the native whitespace layout and colon-delimited records. A non-zero exit means \"no entries\" and is not a failure.",
};

/** Parse one database line using the native whitespace layout for hosts/services, else colon fields. */
function parseLine(database: string, raw: string): Record<string, string> {
  const trimmed = raw.trim();
  const hasWhitespace = /\s/.test(trimmed);
  if (database === "hosts" && hasWhitespace) {
    const parts = trimmed.split(/\s+/);
    return { ip: parts[0] ?? "", names: parts.slice(1).join(" ") };
  }
  if (database === "services" && hasWhitespace) {
    const parts = trimmed.split(/\s+/);
    const [port = "", proto = ""] = (parts[1] ?? "").split("/");
    return { name: parts[0] ?? "", port, proto, aliases: parts.slice(2).join(" ") };
  }

  const names = FIELD_NAMES[database];
  const fields: Record<string, string> = {};
  const values = raw.split(":");
  for (let i = 0; i < values.length; i += 1) {
    fields[names?.[i] ?? `field${i}`] = values[i] ?? "";
  }
  return fields;
}

/** @summary Query `getent <database> [<key>]` and parse each line into `data.getent`. @param ctx ModuleContext carrying `database` and optional `key`. @returns ModuleResult with `data.getent` as an array of `{ raw, fields }`; `changed` is always false. */
export const getentModule: Module = {
  name: MODULE_NAME,
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const args = ctx.args as unknown as GetentArgs;
    const database = typeof args.database === "string" ? args.database.trim() : "";
    if (!database) {
      return { changed: false, failed: true, msg: "getent: 'database' is required" };
    }
    const key = typeof args.key === "string" && args.key.length > 0 ? args.key : undefined;
    const sudo = ctx.become ? "sudo " : "";
    const cmd = `${sudo}getent ${database}${key ? ` ${key}` : ""}`;

    let stdout: string;
    try {
      const res = await ctx.connection.exec(cmd);
      if (res.exitCode !== 0) {
        return {
          changed: false,
          data: { getent: [], database, key: key ?? null },
          msg: `getent: no entries for ${database}${key ? ` ${key}` : ""}`,
        };
      }
      stdout = res.stdout;
    } catch (e) {
      return {
        changed: false,
        failed: true,
        msg: `getent: command failed: ${e instanceof Error ? e.message : String(e)}`,
        data: { getent: [], database, key: key ?? null },
      };
    }

    const entries: GetentEntry[] = stdout
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .map((raw) => ({ raw, fields: parseLine(database, raw) }));

    return {
      changed: false,
      stdout,
      data: { getent: entries, database, key: key ?? null },
      msg: entries.length > 0 ? `getent: ${entries.length} ${database} entr${entries.length === 1 ? "y" : "ies"}` : `getent: no entries for ${database}`,
    };
  },
};

(getentModule as Module & { meta: ModuleSummary }).meta = meta;
export default getentModule;
