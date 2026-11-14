// Batteries-included idempotent `config_edit` module (renamed from `edit`, Todo 27).
//
// Edits a structured section of a file (json/yaml/ini) by key merge, or a fenced
// block section for xml/text formats. Idempotency is intrinsic: `describe` reads
// the current file and reports `inDesired` when the key/block already equals the
// desired value; `converge` only writes when a change is actually needed (and
// even then short-circuits to `changed:false` when the serialized result is
// byte-identical to the current file). Re-running yields no write at all.
// NOTE: `value` REPLACES the target key — there is no native list-append this pass.

import { load as yamlLoad, dump as yamlDump } from "js-yaml";
import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { CheckableModule } from "../../idempotency/types";
import { resource } from "../resource";
import { applyRemoteAttrs, readRemoteFile, writeWithBackupValidate } from "./fs";
import type { ModuleSummary } from "../search";

/** Search metadata for the `config_edit` module (auto-collected by builtins/index.ts). */
export const meta: ModuleSummary = {
  name: "config_edit",
  description:
    "Idempotent structured/file editor: merges/replaces a json/yaml/ini key (or a fenced xml/text block) only when the current state differs.",
  idempotent: true,
  source: "builtin",
  args: {
    path: { type: "string", required: false, description: "Destination path on the target. Alias: `dest`." },
    dest: { type: "string", required: false, description: "Alias for `path` (Ansible parity)." },
    section: { type: "string", required: false, description: "INI section (Ansible `ini_file` parity)." },
    option: { type: "string", required: false, description: "INI option inside `section` (Ansible `ini_file` parity)." },
    create: { type: "boolean", required: false, description: "Create the file when absent (default false)." },
    backup: { type: "boolean", required: false, description: "Rotate a timestamped `.bak` before writing." },
    mode: { type: "string", required: false, description: "Octal mode applied after writing." },
    owner: { type: "string", required: false, description: "Owner applied after writing." },
    group: { type: "string", required: false, description: "Group applied after writing." },
    format: {
      type: "json | yaml | ini | xml | text",
      required: false,
      description: "Structured format for key merge (json/yaml/ini) or fenced block mode (xml/text).",
    },
    key: {
      type: "string",
      required: false,
      description: "Dotted key path into the structure (structured modes).",
    },
    value: {
      type: "unknown",
      required: false,
      description:
        "Desired value at key (structured present) or full value (no key). Note: value REPLACES the key — no native list-append.",
    },
    state: {
      type: "present | absent",
      required: false,
      description: "Desired state (default present).",
    },
    block: {
      type: "string",
      required: false,
      description: "Fenced-block body for xml/text modes.",
    },
    marker: {
      type: "string",
      required: false,
      description: "Marker template; {mark} becomes BEGIN/END + marker_id.",
    },
    marker_id: {
      type: "string",
      required: false,
      description: "Id used inside the fenced markers.",
    },
  },
  // Block-YAML task snippet using RoleCall's structured `$var`/`$concat`/`$call`
  // templating (never Jinja `{{ }}`).
  examples: [
    `- config_edit:
    path: /etc/app.json
    format: json
    key: port
    value: 8080`,
  ],
  notes:
    "`value` REPLACES the key (there is no native list-append this pass). `section`/`option` provide `ini_file` parity (default `create: false` for that form; other structured edits create unless `create: false` is set). `dest` aliases `path`; `backup`/`mode`/`owner`/`group` are supported. Uses RoleCall's structured `$var`/`$concat`/`$call` refs, not Jinja `{{ }}`. Supersedes the removed `file` module for in-place edits.",
};

type EditFormat = "json" | "yaml" | "ini" | "xml" | "text";

interface EditArgs {
  /** Destination path on the target. Required unless `dest` is supplied. */
  path?: string;
  /** Alias for `path` (Ansible parity). */
  dest?: string;
  /** Structured format for key merge: json | yaml | ini. */
  format?: EditFormat;
  /** Dotted key path into the structure (structured modes). */
  key?: string;
  /** INI section for `ini` edits (Ansible `ini_file` parity). */
  section?: string;
  /** INI option inside `section` (Ansible `ini_file` parity). */
  option?: string;
  /** Create the file when absent (default false). */
  create?: boolean;
  /** Rotate a timestamped `.bak` before writing. */
  backup?: boolean;
  /** Octal mode applied after writing. */
  mode?: string;
  /** Owner applied after writing. */
  owner?: string;
  /** Group applied after writing. */
  group?: string;
  /** Desired value at `key` (structured present) or full value (no key). REPLACES the key. */
  value?: unknown;
  /** Desired state: "present" (default) or "absent". */
  state?: "present" | "absent";
  /** Fenced-block body for xml/text modes (or when `format` is omitted + block set). */
  block?: string;
  /** Marker template; `{mark}` is replaced with BEGIN/END + `marker_id`. */
  marker?: string;
  /** Id used inside the fenced markers (xml/text modes). */
  marker_id?: string;
}

/** Resolve the destination path from `path` or its Ansible-parity `dest` alias. */
function editPath(a: EditArgs): string {
  return String(a.path ?? a.dest ?? "");
}

/** Apply an `ini_file`-style section/option edit to an already-parsed INI object. */
function applyIniSectionEdit(obj: Record<string, unknown>, a: EditArgs): void {
  if (a.section === undefined) return;
  const option = a.option;
  if (option === undefined) return;
  if (a.state === "absent") {
    const section = obj[a.section];
    if (section !== null && typeof section === "object") {
      delete (section as Record<string, unknown>)[option];
    }
    return;
  }
  if (obj[a.section] === null || typeof obj[a.section] !== "object") obj[a.section] = {};
  (obj[a.section] as Record<string, unknown>)[option] = a.value;
}

/** Read an `ini_file`-style section/option value from an already-parsed INI object. */
function readIniSectionEdit(obj: Record<string, unknown>, a: EditArgs): unknown {
  if (a.section === undefined) return undefined;
  const section = obj[a.section];
  if (section === null || typeof section !== "object") return undefined;
  return a.option === undefined ? section : (section as Record<string, unknown>)[a.option];
}

// --- dot-path helpers -------------------------------------------------------

function getKey(obj: unknown, key: string): unknown {
  let cur: unknown = obj;
  for (const part of key.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function setKey(obj: unknown, key: string, value: unknown): void {
  const parts = key.split(".");
  let cur = obj as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    if (typeof cur[p] !== "object" || cur[p] === null) cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

function deleteKey(obj: unknown, key: string): void {
  const parts = key.split(".");
  let cur = obj as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    if (typeof cur[p] !== "object" || cur[p] === null) return;
    cur = cur[p] as Record<string, unknown>;
  }
  delete cur[parts[parts.length - 1]!];
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// --- ini (minimal, dependency-free) ----------------------------------------

function parseIni(text: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) {
      section = sec[1]!;
      (root[section] as Record<string, unknown>) ??= {};
      continue;
    }
    const eq = line.match(/^([^=]+)=(.*)$/);
    if (eq) {
      const k = eq[1]!.trim();
      const v = eq[2]!.trim();
      if (section) {
        (root[section] as Record<string, unknown>)[k] = v;
      } else {
        root[k] = v;
      }
    }
  }
  return root;
}

function dumpIni(obj: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "object" && v !== null) {
      lines.push(`[${k}]`);
      for (const [kk, vv] of Object.entries(v as Record<string, unknown>)) {
        lines.push(`${kk} = ${String(vv)}`);
      }
    } else {
      lines.push(`${k} = ${String(v)}`);
    }
  }
  return lines.join("\n") + "\n";
}

function parseStructured(format: EditFormat, text: string): Record<string, unknown> {
  switch (format) {
    case "json":
      return JSON.parse(text) as Record<string, unknown>;
    case "yaml":
      return (yamlLoad(text) as Record<string, unknown>) ?? {};
    case "ini":
      return parseIni(text);
    default:
      throw new Error(`config_edit: unsupported structured format '${format}'`);
  }
}

function serializeStructured(
  format: EditFormat,
  obj: Record<string, unknown>,
): string {
  switch (format) {
    case "json":
      return JSON.stringify(obj, null, 2) + "\n";
    case "yaml":
      return yamlDump(obj);
    case "ini":
      return dumpIni(obj);
    default:
      throw new Error(`config_edit: unsupported structured format '${format}'`);
  }
}

function emptyFor(format: EditFormat): Record<string, unknown> {
  return format === "ini" ? {} : {};
}

// --- fenced-block helpers (xml/text) ----------------------------------------

function blockMarkers(a: EditArgs): { begin: string; end: string } {
  const marker = String(a.marker ?? "# RoleCall BLOCK {mark}");
  const id = String(a.marker_id ?? a.key ?? "edit");
  return {
    begin: marker.replace("{mark}", `BEGIN ${id}`),
    end: marker.replace("{mark}", `END ${id}`),
  };
}

function extractBlock(content: string, begin: string, end: string): string | null {
  const bi = content.indexOf(begin);
  if (bi < 0) return null;
  const ei = content.indexOf(end, bi + begin.length);
  if (ei < 0) return null;
  return content.slice(bi + begin.length, ei).replace(/^\n/, "").replace(/\n$/, "");
}

function replaceOrInsertBlock(
  content: string,
  begin: string,
  end: string,
  block: string,
): string {
  const bi = content.indexOf(begin);
  if (bi >= 0) {
    const ei = content.indexOf(end, bi + begin.length);
    if (ei >= 0) {
      return content.slice(0, bi) + begin + "\n" + block + "\n" + content.slice(ei + end.length);
    }
  }
  return content.replace(/\n*$/, "") + "\n" + begin + "\n" + block + "\n" + end + "\n";
}

function removeBlock(content: string, begin: string, end: string): string {
  const bi = content.indexOf(begin);
  if (bi < 0) return content;
  const ei = content.indexOf(end, bi + begin.length);
  if (ei < 0) return content;
  return content.slice(0, bi) + content.slice(ei + end.length).replace(/^\n/, "");
}

/** @summary Idempotent structured/file editor: merges/replaces a json/yaml/ini key (or a fenced xml/text block) only when the current state differs. @param args EditArgs (path, format, key, value, state, block, marker, marker_id). @returns Module & CheckableModule. */
export const configEditModule: Module & CheckableModule = resource({
  name: "config_edit",
  async describe(args, ctx) {
    const a = args as unknown as EditArgs;
    const path = editPath(a);
    if (!path) return { current: null, inDesired: false };
    const format = (a.format ?? "json") as EditFormat;
    const state = a.state ?? "present";
    const current = await readRemoteFile(ctx.connection, path, ctx.become);

    const fenced = format === "xml" || format === "text" || a.block !== undefined;
    if (fenced) {
      const { begin, end } = blockMarkers(a);
      const block = String(a.block ?? "");
      const present =
        current !== null && extractBlock(current, begin, end) === block;
      const inDesired = state === "present" ? present : !present;
      return { current: current === null ? null : { present }, inDesired };
    }

    if (current === null) return { current: null, inDesired: state === "absent" };
    const obj = parseStructured(format, current);
    const hasSectionEdit = format === "ini" && a.section !== undefined && a.option !== undefined;
    const cur = hasSectionEdit
      ? readIniSectionEdit(obj, a)
      : a.key
        ? getKey(obj, a.key)
        : obj;
    if (state === "present") {
      return { current: cur, inDesired: deepEqual(cur, a.value) };
    }
    const inDesired = hasSectionEdit
      ? cur === undefined
      : a.key
        ? cur === undefined
        : Object.keys(obj).length === 0;
    return { current: cur, inDesired };
  },
  async converge(args, ctx) {
    const a = args as unknown as EditArgs;
    const path = editPath(a);
    if (!path) {
      return { changed: false, failed: true, msg: "config_edit: 'path' (or 'dest') is required" };
    }
    const conn = ctx.connection;
    const format = (a.format ?? "json") as EditFormat;
    const state = a.state ?? "present";
    const current = await readRemoteFile(conn, path, ctx.become);
    const fenced = format === "xml" || format === "text" || a.block !== undefined;
    // `ini_file` semantics default `create` to false; other structured edits keep
    // the historical create-on-write behavior unless explicitly disabled.
    const create = a.create ?? !(format === "ini" && a.section !== undefined);

    const write = async (content: string): Promise<{ failed?: string; backupFile?: string; attrsChanged?: boolean }> => {
      const r = await writeWithBackupValidate(conn, path, content, {
        backup: Boolean(a.backup),
        validate: "",
        become: Boolean(ctx.become),
        existing: current,
      });
      if (r.failed) return { failed: r.failed };
      const attrsChanged = await applyRemoteAttrs(conn, path, a, Boolean(ctx.become));
      return { backupFile: r.backupFile, attrsChanged };
    };

    if (fenced) {
      const { begin, end } = blockMarkers(a);
      const block = String(a.block ?? "");
      if (state === "absent") {
        if (current === null || current.indexOf(begin) < 0) {
          return { changed: false, msg: `${path} block absent (no-op)` };
        }
        const w = await write(removeBlock(current, begin, end));
        if (w.failed) return { changed: false, failed: true, msg: `config_edit: ${w.failed}` };
        return { changed: true, msg: `${path} block removed`, data: { ...(w.backupFile ? { backup_file: w.backupFile } : {}), ...(w.attrsChanged ? { attributes: true } : {}) } };
      }
      if (current === null && !create) {
        return { changed: false, failed: true, msg: `config_edit: ${path} does not exist; set create: true to create it` };
      }
      const next = current === null ? "" : replaceOrInsertBlock(current, begin, end, block);
      if (current !== null && extractBlock(current, begin, end) === block) {
        const attrsChanged = await applyRemoteAttrs(conn, path, a, Boolean(ctx.become));
        return { changed: attrsChanged, msg: attrsChanged ? `${path} attributes updated` : `${path} block unchanged` };
      }
      const w = await write(next);
      if (w.failed) return { changed: false, failed: true, msg: `config_edit: ${w.failed}` };
      return { changed: true, msg: `${path} block written`, data: { ...(w.backupFile ? { backup_file: w.backupFile } : {}), ...(w.attrsChanged ? { attributes: true } : {}) } };
    }

    if (current === null && state === "present" && !create) {
      return { changed: false, failed: true, msg: `config_edit: ${path} does not exist; set create: true to create it` };
    }
    const obj = current === null ? emptyFor(format) : parseStructured(format, current);
    const hasSectionEdit = format === "ini" && a.section !== undefined && a.option !== undefined;
    if (state === "present") {
      if (hasSectionEdit) applyIniSectionEdit(obj, a);
      else if (a.key) setKey(obj, a.key, a.value);
      else if (a.value !== undefined) Object.assign(obj, a.value as Record<string, unknown>);
    } else if (hasSectionEdit) {
      applyIniSectionEdit(obj, a);
    } else if (a.key) {
      deleteKey(obj, a.key);
    }
    const next = serializeStructured(format, obj);
    if (current !== null && current.trim() === next.trim()) {
      const attrsChanged = await applyRemoteAttrs(conn, path, a, Boolean(ctx.become));
      return { changed: attrsChanged, msg: attrsChanged ? `${path} attributes updated` : `${path} unchanged` };
    }
    const w = await write(next);
    if (w.failed) return { changed: false, failed: true, msg: `config_edit: ${w.failed}` };
    return { changed: true, msg: `${path} edited (${format})`, data: { ...(w.backupFile ? { backup_file: w.backupFile } : {}), ...(w.attrsChanged ? { attributes: true } : {}) } };
  },
});

(configEditModule as Module & CheckableModule & { meta: ModuleSummary }).meta = meta;
