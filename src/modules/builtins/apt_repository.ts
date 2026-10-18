// Built-in module: `apt_repository` — Ansible `apt_repository` alternate
// (manage APT source lines under sources.list.d).
//
// Idempotent via `resource()`: `describe` reads the target source-list file and
// reports `inDesired` when the desired `deb` line is already present (present)
// or already gone (absent); `converge` rewrites only that one line and preserves
// every other line in the file. `state: absent` removes just the named source
// line (deleting the file when nothing remains). `validate_certs: false` maps to
// an apt `[trusted=yes]` option in the source line, and `update_cache: true`
// runs `apt-get update` after a change. A `--check`/`check: true` invocation
// reports `wouldChange` without writing.

import type { Module } from "../../executor/module";
import type { CheckableModule } from "../../idempotency/types";
import { resource } from "../resource";
import { readRemoteFile, shQuote, wrapCommand, writeRemoteFileExact } from "./fs";
import type { ModuleSummary } from "../search";

const MODULE_NAME = "apt_repository";

/** @summary Arguments for the `apt_repository` module. @property repo Full APT source line, e.g. `deb http://… jammy main` (required). @property filename File name under /etc/apt/sources.list.d (default `rolecall.list`; `.list` is appended when missing). @property state `present` (default) or `absent`. @property validate_certs When false, rewrite the source line with apt's `[trusted=yes]` option. @property update_cache Run `apt-get update` after a change. */
export interface AptRepositoryArgs {
  /** Full APT source line, e.g. `deb http://archive.ubuntu.com/ubuntu jammy main`. Required. */
  repo: string;
  /** File name under `/etc/apt/sources.list.d` (default `rolecall.list`; `.list` is appended when absent). */
  filename?: string;
  /** `present` (default) ensures the source line; `absent` removes it. */
  state?: "present" | "absent";
  /** When false, add apt's `[trusted=yes]` option so TLS validation is skipped. Default true. */
  validate_certs?: boolean;
  /** Run `apt-get update` after the source list changes (default false). */
  update_cache?: boolean;
  /** Internal: set by the `--check` global passthrough. */
  _check?: unknown;
  /** Internal: set by the `--check` global passthrough. */
  check?: unknown;
}

/** Search metadata for the `apt_repository` module (auto-collected by builtins/index.ts). */
export const meta: ModuleSummary = {
  name: MODULE_NAME,
  description:
    "Manage an APT source line (Ansible `apt_repository` alternate) under /etc/apt/sources.list.d. Idempotent: re-running with the same repo is a no-op and other lines in the file are preserved.",
  idempotent: true,
  source: "builtin",
  args: {
    repo: { type: "string", required: true, description: "Full apt source line, e.g. 'deb http://archive.ubuntu.com/ubuntu jammy main'." },
    filename: { type: "string", required: false, description: "File under sources.list.d (default rolecall.list); '.list' is appended when missing." },
    state: { type: "present | absent", required: false, description: "Desired state (default present)." },
    validate_certs: { type: "boolean", required: false, description: "Validate the repository TLS certificate (default true). When false, the source line gets an apt [trusted=yes] option." },
    update_cache: { type: "boolean", required: false, description: "Run `apt-get update` after the source list changes (default false)." },
  },
  examples: [
    `- apt_repository:
    repo: "deb http://apt.nginx.org/ubuntu jammy nginx"
    filename: nginx.list
    state: present`,
    `- apt_repository:
    repo: "deb [arch=amd64] https://download.docker.com/linux/ubuntu jammy stable"
    filename: docker.list
    update_cache: true`,
  ],
  notes:
    "≠ Ansible `apt_repository`: `filename` defaults to rolecall.list (not a URL-derived name), `update_cache` defaults to false, and `codename`/`arch`/`signed_by`/`comment` are not auto-composed — pass a complete `repo` line instead. `validate_certs: false` maps to an apt `[trusted=yes]` source option. Uses `$var` refs, not Jinja `{{ }}`.",
};

/** Normalize a filename to end in `.list` (APT only reads list files with a recognized extension). */
function normalizeFilename(filename?: string): string {
  const f = typeof filename === "string" && filename.length > 0 ? filename : "rolecall.list";
  return /\.[A-Za-z0-9]+$/.test(f) ? f : `${f}.list`;
}

/** Insert the apt `[trusted=yes]` option into a `deb`/`deb-src` line, preserving any existing options. */
function withTrustedOption(repo: string): string {
  const m = repo.match(/^(deb(?:-src)?)\s+(?:\[([^\]]*)\]\s+)?(.*)$/);
  if (!m) return repo;
  const opts = m[2] ? m[2].split(/\s+/).filter(Boolean) : [];
  if (!opts.includes("trusted=yes")) opts.unshift("trusted=yes");
  return `${m[1]} [${opts.join(" ")}] ${m[3]}`;
}

/** Split source-list text into logical lines, dropping trailing blank lines. */
function toLines(content: string): string[] {
  const lines = content.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** The exact source line the module manages (with `[trusted=yes]` when cert validation is off). */
function desiredLine(a: AptRepositoryArgs): string {
  const repo = typeof a.repo === "string" ? a.repo.trim() : "";
  return a.validate_certs === false ? withTrustedOption(repo) : repo;
}

/** @summary Idempotent `apt_repository` module: `describe` reads the source-list file, `converge` rewrites only the managed line. @param args AptRepositoryArgs (repo, filename, state, validate_certs, update_cache). @returns Module & CheckableModule. */
export const aptRepositoryModule: Module & CheckableModule = resource({
  name: MODULE_NAME,
  async describe(args, ctx) {
    const a = args as unknown as AptRepositoryArgs;
    const repo = typeof a.repo === "string" ? a.repo.trim() : "";
    if (!repo) return { current: null, inDesired: false };
    const path = `/etc/apt/sources.list.d/${normalizeFilename(a.filename)}`;
    const raw = (await readRemoteFile(ctx.connection, path, Boolean(ctx.become))) ?? "";
    const present = toLines(raw).some((l) => l.trim() === desiredLine(a));
    const state = a.state ?? "present";
    return {
      current: { path, present },
      inDesired: state === "absent" ? !present : present,
    };
  },
  async converge(args, ctx) {
    const a = args as unknown as AptRepositoryArgs;
    const repo = typeof a.repo === "string" ? a.repo.trim() : "";
    if (!repo) return { changed: false, failed: true, msg: "apt_repository: 'repo' is required" };
    const state = a.state ?? "present";
    const filename = normalizeFilename(a.filename);
    const path = `/etc/apt/sources.list.d/${filename}`;
    const desired = desiredLine(a);

    const raw = (await readRemoteFile(ctx.connection, path, Boolean(ctx.become))) ?? "";
    const lines = toLines(raw);
    const kept = lines.filter((l) => l.trim() !== desired);
    const next = state === "absent" ? kept : [...kept, desired];
    const nextContent = next.length > 0 ? next.join("\n") + "\n" : "";
    const oldContent = lines.length > 0 ? lines.join("\n") + "\n" : "";
    if (nextContent === oldContent) {
      return { changed: false, skipped: true, msg: `apt_repository: ${filename} unchanged` };
    }
    if (Boolean(a._check ?? a.check)) {
      return {
        changed: false,
        skipped: true,
        msg: `apt_repository: ${filename} would be ${state === "absent" ? "removed" : "updated"}`,
        data: { wouldChange: true, filename, state },
      };
    }
    const data = { filename, path, repo, state };

    const wrapOpts = { become: Boolean(ctx.become), becomeUser: ctx.become_user, environment: ctx.environment };
    if (state === "absent" && next.length === 0) {
      const rm = await ctx.connection.exec(wrapCommand(`rm -f ${shQuote(path)}`, wrapOpts));
      if (rm.exitCode !== 0) {
        return { changed: false, failed: true, msg: `apt_repository: remove failed: ${rm.stderr || `exit ${rm.exitCode}`}`, data };
      }
    } else {
      const dir = path.replace(/\/[^/]+$/, "");
      const mk = await ctx.connection.exec(wrapCommand(`mkdir -p ${shQuote(dir)}`, wrapOpts));
      if (mk.exitCode !== 0) {
        return { changed: false, failed: true, msg: `apt_repository: mkdir failed: ${mk.stderr || `exit ${mk.exitCode}`}`, data };
      }
      try {
        await writeRemoteFileExact(ctx.connection, path, nextContent, Boolean(ctx.become));
      } catch (e) {
        return { changed: false, failed: true, msg: `apt_repository: ${e instanceof Error ? e.message : String(e)}`, data };
      }
    }

    if (a.update_cache === true) {
      const upd = await ctx.connection.exec(wrapCommand("apt-get update", wrapOpts));
      if (upd.exitCode !== 0) {
        return { changed: true, failed: true, msg: `apt_repository: ${filename} ${state}, but apt-get update failed: ${upd.stderr || `exit ${upd.exitCode}`}`, data };
      }
    }
    return { changed: true, msg: `apt_repository: ${filename} ${state}`, data };
  },
});

(aptRepositoryModule as Module & CheckableModule & { meta: ModuleSummary }).meta = meta;
export default aptRepositoryModule;
