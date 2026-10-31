// Built-in module: `archive` — Ansible `archive` alternate (bundle files on the target).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** @summary Bundle files on the target into an archive (Ansible `archive` alternate). @param ctx ModuleContext carrying `path` (dest archive), `format`, `src` (list of files/dirs), `exclude_path`, `remove`, `force_archive`. @returns ModuleResult with the archive path in `data`; `skipped` when the destination is already at least as new as every source. */
export const archiveModule: Module = {
  name: "archive",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const a = ctx.args;
    const path = typeof a["path"] === "string" ? String(a["path"]) : "";
    if (!path) return { changed: false, failed: true, msg: "archive: 'path' (dest archive) is required" };
    const format = typeof a["format"] === "string" ? String(a["format"]) : /\.zip$/i.test(path) ? "zip" : "tar";
    const srcList = Array.isArray(a["src"]) ? (a["src"] as unknown[]).map(String) : typeof a["src"] === "string" ? [String(a["src"])] : [];
    if (srcList.length === 0) return { changed: false, failed: true, msg: "archive: 'src' (list of files) is required" };
    const excludeList = Array.isArray(a["exclude_path"])
      ? (a["exclude_path"] as unknown[]).map(String)
      : typeof a["exclude_path"] === "string" ? [String(a["exclude_path"])] : [];
    const remove = Boolean(a["remove"]);
    const forceArchive = Boolean(a["force_archive"]);

    if (!forceArchive) {
      const statRes = await ctx.connection.exec(`stat -c %Y ${shQuote(path)}`);
      if (statRes.exitCode === 0) {
        const archiveMtime = Number.parseInt(statRes.stdout.trim(), 10);
        const srcFind = await ctx.connection.exec(`find ${srcList.map(shQuote).join(" ")} -printf '%T@\\n' | sort -n | tail -1`);
        const newestSource = Number.parseFloat(srcFind.stdout.trim());
        if (
          srcFind.exitCode === 0 &&
          Number.isFinite(archiveMtime) &&
          Number.isFinite(newestSource) &&
          archiveMtime >= newestSource
        ) {
          return { changed: false, skipped: true, msg: `archive: skipped, ${path} is at least as new as its sources` };
        }
      }
    }

    const cmd = format === "zip"
      ? `zip -r ${shQuote(path)} ${srcList.map(shQuote).join(" ")}${excludeList.map((p) => ` -x ${shQuote(p)}`).join("")}`
      : `tar -cf ${shQuote(path)}${excludeList.map((p) => ` --exclude=${shQuote(p)}`).join("")} ${srcList.map(shQuote).join(" ")}`;
    const run = ctx.become ? `sudo sh -c ${shQuote(cmd)}` : cmd;
    const res = await ctx.connection.exec(run);
    if (res.exitCode !== 0) return { changed: false, failed: true, msg: `archive: failed: ${res.stderr || `exit ${res.exitCode}`}` };

    if (remove) {
      for (const s of srcList) {
        await ctx.connection.exec(`${ctx.become ? "sudo " : ""}rm -rf ${shQuote(s)}`);
      }
    }

    return { changed: true, msg: `archive: -> ${path}`, data: { path, format } };
  },
};

/** Search metadata for the `archive` module. */
export const meta: ModuleSummary = {
  name: "archive",
  description: "Bundle files on the target into an archive (Ansible `archive` alternate). Supports tar/zip, `exclude_path` filtering, source removal, and an mtime-based up-to-date skip.",
  source: "builtin",
  args: {
    path: { type: "string", required: true, description: "Destination archive path." },
    src: { type: "string | string[]", required: true, description: "Files/dirs to include." },
    format: { type: "tar | zip", required: false, description: "Archive format (default tar; zip if path ends .zip)." },
    exclude_path: { type: "string | string[]", required: false, description: "Paths to exclude (tar `--exclude`, zip `-x`)." },
    remove: { type: "boolean", required: false, description: "After a successful archive, `rm -rf` each `src` path (default false)." },
    force_archive: { type: "boolean", required: false, description: "Recreate the archive even when it is at least as new as its sources (default false)." },
  },
  examples: [
    `- archive:
    path: /backup/etc.tar
    src:
      - /etc/nginx
      - /etc/ssh`,
  ],
  notes: "≠ Ansible `archive`: `force_archive` false (default) skips when the destination is at least as new as every source (mtime comparison; proceeds when either mtime is unreadable). `remove` deletes sources after archiving and `exclude_path` filters entries.",
};

(archiveModule as Module & { meta: ModuleSummary }).meta = meta;
export default archiveModule;
