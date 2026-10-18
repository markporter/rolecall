// Built-in module: `unarchive` — Ansible `unarchive` alternate (extract an archive on the target).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** @summary Extract an archive on the target (Ansible `unarchive` alternate). Reads `src` on the target and extracts into `dest`; skips when `creates` already exists. @param ctx ModuleContext carrying `src`, `dest`, `creates`, `remote_src`, `check`. @returns ModuleResult; `skipped` when guarded. */
export const unarchiveModule: Module = {
  name: "unarchive",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const a = ctx.args;
    const src = typeof a["src"] === "string" ? String(a["src"]) : "";
    const dest = typeof a["dest"] === "string" ? String(a["dest"]) : "";
    if (!src || !dest) return { changed: false, failed: true, msg: "unarchive: 'src' and 'dest' are required" };
    const creates = typeof a["creates"] === "string" ? String(a["creates"]) : "";
    const check = Boolean(a["check"] ?? a["_check"]);

    if (creates) {
      const r = await ctx.connection.exec(`test -e ${shQuote(creates)}`);
      if (r.exitCode === 0) return { changed: false, skipped: true, msg: `unarchive: skipped, ${creates} exists` };
    }

    const isZip = /\.zip$/i.test(src);
    const extract = isZip
      ? `unzip -o ${shQuote(src)} -d ${shQuote(dest)}`
      : `mkdir -p ${shQuote(dest)} && tar -xf ${shQuote(src)} -C ${shQuote(dest)}`;
    const cmd = ctx.become ? `sudo sh -c ${shQuote(extract)}` : extract;
    if (check) return { changed: true, skipped: true, msg: `unarchive: would extract ${src} (dry run)` };
    const res = await ctx.connection.exec(cmd);
    if (res.exitCode !== 0) return { changed: false, failed: true, msg: `unarchive: failed: ${res.stderr || `exit ${res.exitCode}`}` };
    return { changed: true, msg: `unarchive: ${src} -> ${dest}`, data: { src, dest } };
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
  },
  examples: [
    `- unarchive:
    src: /tmp/app.tar.gz
    dest: /opt/app
    creates: /opt/app/.installed`,
  ],
  notes: "≠ Ansible `unarchive`: `remote_src` is always true (RoleCall extracts on the target); no `keep_newer`/per-file diff — re-running re-extracts unless `creates` guards it.",
};

(unarchiveModule as Module & { meta: ModuleSummary }).meta = meta;
export default unarchiveModule;
