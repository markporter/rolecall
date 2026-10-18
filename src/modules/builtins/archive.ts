// Built-in module: `archive` — Ansible `archive` alternate (bundle files on the target).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** @summary Bundle files on the target into an archive (Ansible `archive` alternate). @param ctx ModuleContext carrying `path` (dest archive), `format`, `src` (list of files/dirs). @returns ModuleResult with the archive path in `data`. */
export const archiveModule: Module = {
  name: "archive",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const a = ctx.args;
    const path = typeof a["path"] === "string" ? String(a["path"]) : "";
    if (!path) return { changed: false, failed: true, msg: "archive: 'path' (dest archive) is required" };
    const format = typeof a["format"] === "string" ? String(a["format"]) : /\.zip$/i.test(path) ? "zip" : "tar";
    const srcList = Array.isArray(a["src"]) ? (a["src"] as unknown[]).map(String) : typeof a["src"] === "string" ? [String(a["src"])] : [];
    if (srcList.length === 0) return { changed: false, failed: true, msg: "archive: 'src' (list of files) is required" };

    const cmd = format === "zip"
      ? `zip -r ${shQuote(path)} ${srcList.map(shQuote).join(" ")}`
      : `tar -cf ${shQuote(path)} ${srcList.map(shQuote).join(" ")}`;
    const run = ctx.become ? `sudo sh -c ${shQuote(cmd)}` : cmd;
    const res = await ctx.connection.exec(run);
    if (res.exitCode !== 0) return { changed: false, failed: true, msg: `archive: failed: ${res.stderr || `exit ${res.exitCode}`}` };
    return { changed: true, msg: `archive: -> ${path}`, data: { path, format } };
  },
};

/** Search metadata for the `archive` module. */
export const meta: ModuleSummary = {
  name: "archive",
  description: "Bundle files on the target into an archive (Ansible `archive` alternate). Supports tar/zip; always recreates the archive (not diff-based).",
  source: "builtin",
  args: {
    path: { type: "string", required: true, description: "Destination archive path." },
    src: { type: "string | string[]", required: true, description: "Files/dirs to include." },
    format: { type: "tar | zip", required: false, description: "Archive format (default tar; zip if path ends .zip)." },
  },
  examples: [
    `- archive:
    path: /backup/etc.tar
    src:
      - /etc/nginx
      - /etc/ssh`,
  ],
  notes: "≠ Ansible `archive`: always recreates the archive (no `remove`/mtime check); no `exclude_path` filtering yet.",
};

(archiveModule as Module & { meta: ModuleSummary }).meta = meta;
export default archiveModule;
