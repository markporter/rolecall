// Built-in module: `unarchive` — Ansible `unarchive` alternate (extract an archive on the target).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { applyRemoteAttrs, shQuote } from "./fs";

/** @summary Extract an archive on the target (Ansible `unarchive` alternate). Reads `src` on the target and extracts into `dest`; skips when `creates` already exists. @param ctx ModuleContext carrying `src`, `dest`, `creates`, `keep_newer`, `owner`, `group`, `remote_src`, `check`. @returns ModuleResult; `skipped` when guarded. */
export const unarchiveModule: Module = {
  name: "unarchive",
  supportsCheck: true,
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const a = ctx.args;
    const src = typeof a["src"] === "string" ? String(a["src"]) : "";
    const dest = typeof a["dest"] === "string" ? String(a["dest"]) : "";
    if (!src || !dest) return { changed: false, failed: true, msg: "unarchive: 'src' and 'dest' are required" };
    const creates = typeof a["creates"] === "string" ? String(a["creates"]) : "";
    const keepNewer = Boolean(a["keep_newer"]);
    const check = Boolean(a["check"] ?? a["_check"]);
    if (a["remote_src"] === false) {
      return {
        changed: false,
        failed: true,
        msg: "unarchive: extraction always runs on the target; stage the archive with copy first instead of remote_src: false",
      };
    }

    if (creates) {
      const r = await ctx.connection.exec(`test -e ${shQuote(creates)}`);
      if (r.exitCode === 0) return { changed: false, skipped: true, msg: `unarchive: skipped, ${creates} exists` };
    }

    const isZip = /\.zip$/i.test(src);
    const extract = isZip
      ? `unzip ${keepNewer ? "-n " : ""}-o ${shQuote(src)} -d ${shQuote(dest)}`
      : `mkdir -p ${shQuote(dest)} && tar ${keepNewer ? "--keep-newer-files " : ""}-xf ${shQuote(src)} -C ${shQuote(dest)}`;
    const cmd = ctx.become ? `sudo sh -c ${shQuote(extract)}` : extract;
    if (check) return { changed: true, skipped: true, msg: `unarchive: would extract ${src} (dry run)` };
    const res = await ctx.connection.exec(cmd);
    if (res.exitCode !== 0) return { changed: false, failed: true, msg: `unarchive: failed: ${res.stderr || `exit ${res.exitCode}`}` };
    const attrsChanged = await applyRemoteAttrs(
      ctx.connection,
      dest,
      { owner: a["owner"], group: a["group"] },
      Boolean(ctx.become),
      { recurse: true },
    );
    return { changed: true, msg: `unarchive: ${src} -> ${dest}`, data: { src, dest, ...(attrsChanged ? { attributes: true } : {}) } };
  },
};

/** Search metadata for the `unarchive` module. */
export const meta: ModuleSummary = {
  name: "unarchive",
  description: "Extract an archive on the target (Ansible `unarchive` alternate). Supports .tar/.tar.gz/.tgz/.zip; skips when `creates` exists.",
  source: "builtin",
  args: {
    src: { type: "string", required: true, description: "Remote archive path to extract." },
    dest: { type: "string", required: true, description: "Remote directory to extract into." },
    creates: { type: "string", required: false, description: "Skip the task if this path exists." },
    keep_newer: { type: "boolean", required: false, description: "Preserve files newer than the archive (tar `--keep-newer-files`; zip `-n`)." },
    owner: { type: "string", required: false, description: "Owner applied recursively to the extracted tree." },
    group: { type: "string", required: false, description: "Group applied recursively to the extracted tree." },
    remote_src: {
      type: "boolean",
      required: false,
      description: "Accepted for Ansible parity; extraction always runs on the target. `false` is rejected with guidance to stage the archive with copy first.",
    },
  },
  examples: [
    `- unarchive:
    src: /tmp/app.tar.gz
    dest: /opt/app
    creates: /opt/app/.installed`,
  ],
  notes: "≠ Ansible `unarchive`: extraction always runs on the target, so `remote_src: true` is implicit and `false` is rejected; stage a controller-side archive with `copy` first. `owner`/`group` are applied recursively after extraction. No per-file diff — re-running re-extracts unless `creates` guards it. `keep_newer` maps to tar `--keep-newer-files`; for zip it uses `-n` (never overwrite), the closest available option — note that `-n` takes precedence over the default `-o` overwrite.",
};

(unarchiveModule as Module & { meta: ModuleSummary }).meta = meta;
export default unarchiveModule;
