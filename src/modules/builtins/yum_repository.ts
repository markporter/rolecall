// Built-in module: `yum_repository` — Ansible `yum_repository` alternate
// (manage YUM/DNF `.repo` INI sections under /etc/yum.repos.d).
//
// Idempotent via `resource()`: `describe` parses the target repo file, compares
// the managed `[<name>]` section's key/value map against the desired map, and
// reports `inDesired` only on an exact match. `converge` rewrites just that
// section and leaves every other section (and any local comments) in the file
// untouched. `state: absent` removes only the named section (deleting the file
// when no sections remain). A `--check`/`check: true` invocation reports
// `wouldChange` without writing.

import type { Module } from "../../executor/module";
import type { CheckableModule } from "../../idempotency/types";
import { resource } from "../resource";
import { readRemoteFile, shQuote, wrapCommand, writeRemoteFileExact } from "./fs";
import type { ModuleSummary } from "../search";

const MODULE_NAME = "yum_repository";

/** @summary Arguments for the `yum_repository` module. @property name Repo id / `[<name>]` section (required). @property description Human-readable `name=` line (defaults to the repo id). @property baseurl/baseurl… Repository URL fields. @property gpgcheck Enable GPG signature check (default false). @property repo_gpgcheck Enable GPG check for metadata (written only when set). @property enabled Enable the repo (default true). @property gpgkey GPG key URL(s). @property file Repo file basename under /etc/yum.repos.d (default = name; `.repo` appended when missing). @property state `present` (default) or `absent`. */
export interface YumRepositoryArgs {
  /** Repo id, written as the `[<name>]` section header. Required. */
  name: string;
  /** Human-readable repository name (the `name=` line). Defaults to the repo id. */
  description?: string;
  /** Base URL for the repository. */
  baseurl?: string;
  /** Mirrorlist URL for the repository. */
  mirrorlist?: string;
  /** Metalink URL for the repository. */
  metalink?: string;
  /** Enable GPG signature checking (default false). */
  gpgcheck?: boolean;
  /** Enable GPG checking of repository metadata (written only when supplied). */
  repo_gpgcheck?: boolean;
  /** Enable the repository (default true). */
  enabled?: boolean;
  /** URL of the GPG key used to verify packages (written only when supplied). */
  gpgkey?: string;
  /** Repo file basename under `/etc/yum.repos.d` (default = `name`; `.repo` appended when missing). */
  file?: string;
  /** `present` (default) ensures the section; `absent` removes it. */
  state?: "present" | "absent";
  /** Internal: set by the `--check` global passthrough. */
  _check?: unknown;
  /** Internal: set by the `--check` global passthrough. */
  check?: unknown;
}

/** One parsed `[<name>]` section plus its raw body lines. */
interface RawSection {
  /** Section header name (text between the brackets). */
  name: string;
  /** Body lines following the header, up to the next header. */
  body: string[];
}

/** Parsed representation of a `.repo` file. */
interface ParsedRepoFile {
  /** Lines before the first section header (usually comments or blank). */
  preamble: string[];
  /** Sections in file order. */
  sections: RawSection[];
}

/** Search metadata for the `yum_repository` module (auto-collected by builtins/index.ts). */
export const meta: ModuleSummary = {
  name: MODULE_NAME,
  description:
    "Manage a YUM/DNF repo file section (Ansible `yum_repository` alternate). Writes an `[<name>]` INI section to /etc/yum.repos.d/<file>.repo idempotently and preserves other sections.",
  idempotent: true,
  source: "builtin",
  args: {
    name: { type: "string", required: true, description: "Repo id (the `[<name>]` section)." },
    description: { type: "string", required: false, description: "Human-readable repository name (defaults to the repo id)." },
    baseurl: { type: "string", required: false, description: "Base URL." },
    mirrorlist: { type: "string", required: false, description: "Mirrorlist URL." },
    metalink: { type: "string", required: false, description: "Metalink URL." },
    gpgcheck: { type: "boolean", required: false, description: "Enable GPG signature check (default false)." },
    repo_gpgcheck: { type: "boolean", required: false, description: "Enable GPG check of metadata (written only when set)." },
    enabled: { type: "boolean", required: false, description: "Enable the repo (default true)." },
    gpgkey: { type: "string", required: false, description: "GPG key URL used to verify packages." },
    file: { type: "string", required: false, description: "Repo filename without extension (default = name)." },
    state: { type: "present | absent", required: false, description: "Desired state (default present)." },
  },
  examples: [
    `- yum_repository:
    name: nginx-stable
    description: nginx stable
    baseurl: http://nginx.org/packages/centos/7/$basearch/
    gpgcheck: false
    enabled: true`,
    `- yum_repository:
    name: epel
    description: Extra Packages for Enterprise Linux
    mirrorlist: https://mirrors.fedoraproject.org/metalink?repo=epel-9&arch=$basearch
    gpgcheck: true
    gpgkey: https://dl.fedoraproject.org/pub/epel/RPM-GPG-KEY-EPEL-9`,
  ],
  notes:
    "≠ Ansible `yum_repository`: only the base INI fields are written (no `cost`/`priority`/`exclude`/`includepkgs`/`sslcacert`/`sslverify`, no `gpgkey` auto-import — add a `shell` task to import keys). `description` defaults to the repo id, `enabled` to true, and `gpgcheck` to false. Uses `$var` refs, not Jinja `{{ }}`.",
};

/** Normalize a repo file basename to end in `.repo`. */
function normalizeFile(file: string | undefined, name: string): string {
  const f = typeof file === "string" && file.length > 0 ? file : name;
  return f.endsWith(".repo") ? f : `${f}.repo`;
}

/** Parse a `.repo` file into its preamble plus ordered sections. */
function parseRepoFile(content: string): ParsedRepoFile {
  const lines = content.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const preamble: string[] = [];
  const sections: RawSection[] = [];
  let current: RawSection | null = null;
  for (const line of lines) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) {
      current = { name: header[1]!.trim(), body: [] };
      sections.push(current);
    } else if (current) {
      current.body.push(line);
    } else {
      preamble.push(line);
    }
  }
  return { preamble, sections };
}

/** Serialize a parsed repo file back to text (blank-line separated sections, trailing newline). */
function serializeRepoFile(parsed: ParsedRepoFile): string {
  const blocks: string[] = [];
  const preamble = parsed.preamble.filter((l) => l.trim() !== "");
  if (preamble.length > 0) blocks.push(preamble.join("\n"));
  for (const s of parsed.sections) blocks.push([`[${s.name}]`, ...s.body].join("\n"));
  if (blocks.length === 0) return "";
  return blocks.join("\n\n").replace(/\n+$/, "") + "\n";
}

/** Parse `key=value` body lines into a lower-cased key map (comments and blanks ignored). */
function bodyMap(body: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const line of body) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    map[line.slice(0, eq).trim().toLowerCase()] = line.slice(eq + 1).trim();
  }
  return map;
}

/** True when two key maps have identical key sets and values. */
function mapsEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  return ak.length === bk.length && ak.every((k) => a[k] === b[k]);
}

/** Build the canonical desired section body (deterministic key order). */
function desiredBody(a: YumRepositoryArgs): string[] {
  const body = [`name=${typeof a.description === "string" ? a.description : a.name}`];
  if (typeof a.baseurl === "string") body.push(`baseurl=${a.baseurl}`);
  if (typeof a.mirrorlist === "string") body.push(`mirrorlist=${a.mirrorlist}`);
  if (typeof a.metalink === "string") body.push(`metalink=${a.metalink}`);
  body.push(`gpgcheck=${a.gpgcheck ? "1" : "0"}`);
  if (a.repo_gpgcheck !== undefined) body.push(`repo_gpgcheck=${a.repo_gpgcheck ? "1" : "0"}`);
  body.push(`enabled=${a.enabled === false ? "0" : "1"}`);
  if (typeof a.gpgkey === "string") body.push(`gpgkey=${a.gpgkey}`);
  return body;
}

/** @summary Idempotent `yum_repository` module: `describe` compares the managed section's key map, `converge` rewrites only that section. @param args YumRepositoryArgs (name, description, baseurl/mirrorlist/metalink, gpgcheck, enabled, file, state). @returns Module & CheckableModule. */
export const yumRepositoryModule: Module & CheckableModule = resource({
  name: MODULE_NAME,
  async describe(args, ctx) {
    const a = args as unknown as YumRepositoryArgs;
    const name = typeof a.name === "string" ? a.name : "";
    if (!name) return { current: null, inDesired: false };
    const path = `/etc/yum.repos.d/${normalizeFile(a.file, name)}`;
    const raw = (await readRemoteFile(ctx.connection, path, Boolean(ctx.become))) ?? "";
    const existing = parseRepoFile(raw).sections.find((s) => s.name === name);
    const state = a.state ?? "present";
    if (state === "absent") {
      return { current: { path, present: existing !== undefined }, inDesired: existing === undefined };
    }
    if (existing === undefined) {
      return { current: { path, present: false }, inDesired: false };
    }
    return {
      current: { path, present: true },
      inDesired: mapsEqual(bodyMap(existing.body), bodyMap(desiredBody(a))),
    };
  },
  async converge(args, ctx) {
    const a = args as unknown as YumRepositoryArgs;
    const name = typeof a.name === "string" ? a.name : "";
    if (!name) return { changed: false, failed: true, msg: "yum_repository: 'name' (repo id) is required" };
    const state = a.state ?? "present";
    const hasUrl =
      typeof a.baseurl === "string" || typeof a.mirrorlist === "string" || typeof a.metalink === "string";
    if (state === "present" && !hasUrl) {
      return { changed: false, failed: true, msg: "yum_repository: one of 'baseurl', 'mirrorlist', or 'metalink' is required when state=present" };
    }

    const filename = normalizeFile(a.file, name);
    const path = `/etc/yum.repos.d/${filename}`;
    const raw = (await readRemoteFile(ctx.connection, path, Boolean(ctx.become))) ?? "";
    const parsed = parseRepoFile(raw);
    const others = parsed.sections.filter((s) => s.name !== name);

    if (state === "absent") {
      const found = parsed.sections.length !== others.length;
      if (!found) return { changed: false, skipped: true, msg: `yum_repository: ${name} already absent` };
      const nextParsed: ParsedRepoFile = { preamble: parsed.preamble, sections: others };
      const nextContent = serializeRepoFile(nextParsed);
      if (Boolean(a._check ?? a.check)) {
        return { changed: false, skipped: true, msg: `yum_repository: ${name} would be removed`, data: { wouldChange: true, name, state } };
      }
      const data = { name, path, file: filename, state };
      if (nextContent === "") {
        const rm = await ctx.connection.exec(wrapCommand(`rm -f ${shQuote(path)}`, { become: Boolean(ctx.become), becomeUser: ctx.become_user, environment: ctx.environment }));
        if (rm.exitCode !== 0) return { changed: false, failed: true, msg: `yum_repository: remove failed: ${rm.stderr || `exit ${rm.exitCode}`}`, data };
      } else {
        try {
          await writeRemoteFileExact(ctx.connection, path, nextContent, Boolean(ctx.become));
        } catch (e) {
          return { changed: false, failed: true, msg: `yum_repository: ${e instanceof Error ? e.message : String(e)}`, data };
        }
      }
      return { changed: true, msg: `yum_repository: ${name} absent`, data };
    }

    const nextParsed: ParsedRepoFile = {
      preamble: parsed.preamble,
      sections: [...others, { name, body: desiredBody(a) }],
    };
    const nextContent = serializeRepoFile(nextParsed);
    const oldContent = serializeRepoFile(parsed);
    if (nextContent === oldContent) {
      return { changed: false, skipped: true, msg: `yum_repository: ${name} unchanged` };
    }
    if (Boolean(a._check ?? a.check)) {
      return { changed: false, skipped: true, msg: `yum_repository: ${name} would be written`, data: { wouldChange: true, name, state } };
    }
    const data = { name, path, file: filename, state, baseurl: a.baseurl ?? null };
    const dir = path.replace(/\/[^/]+$/, "");
    const wrapOpts = { become: Boolean(ctx.become), becomeUser: ctx.become_user, environment: ctx.environment };
    const mk = await ctx.connection.exec(wrapCommand(`mkdir -p ${shQuote(dir)}`, wrapOpts));
    if (mk.exitCode !== 0) {
      return { changed: false, failed: true, msg: `yum_repository: mkdir failed: ${mk.stderr || `exit ${mk.exitCode}`}`, data };
    }
    try {
      await writeRemoteFileExact(ctx.connection, path, nextContent, Boolean(ctx.become));
    } catch (e) {
      return { changed: false, failed: true, msg: `yum_repository: ${e instanceof Error ? e.message : String(e)}`, data };
    }
    return { changed: true, msg: `yum_repository: ${name} present`, data };
  },
});

(yumRepositoryModule as Module & CheckableModule & { meta: ModuleSummary }).meta = meta;
export default yumRepositoryModule;
