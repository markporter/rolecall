// Built-in module: `assemble` — Ansible `assemble` alternate (concatenate remote files).

import { join } from "node:path";
import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** @summary Concatenate files from a remote directory into one file (Ansible `assemble` alternate). Reads each matching file on the target and writes the concatenation to `dest`. @param ctx ModuleContext carrying `src` (remote dir), `dest`, `regexp`, `remote_src`. @returns ModuleResult with the assembled count in `data`. */
export const assembleModule: Module = {
  name: "assemble",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const src = typeof ctx.args["src"] === "string" ? String(ctx.args["src"]) : "";
    const dest = typeof ctx.args["dest"] === "string" ? String(ctx.args["dest"]) : "";
    if (!src || !dest) return { changed: false, failed: true, msg: "assemble: 'src' and 'dest' are required" };
    const regexp = typeof ctx.args["regexp"] === "string" ? String(ctx.args["regexp"]) : "";

    const list = await ctx.connection.exec(`ls -1 ${shQuote(src)}`);
    if (list.exitCode !== 0) return { changed: false, failed: true, msg: `assemble: cannot list ${src}` };
    let files = list.stdout.split("\n").map((s) => s.trim()).filter(Boolean).sort();
    if (regexp) {
      const re = new RegExp(regexp);
      files = files.filter((f) => re.test(f));
    }

    let out = "";
    for (const f of files) {
      const r = await ctx.connection.exec(`cat ${shQuote(join(src, f))}`);
      if (r.exitCode === 0) out += r.stdout;
    }

    const delim = `RoleCallASM_${Date.now()}`;
    const w = await ctx.connection.exec(`cat > ${shQuote(dest)} <<'${delim}'\n${out}\n${delim}`);
    if (w.exitCode !== 0) return { changed: false, failed: true, msg: `assemble: write failed: ${w.stderr || `exit ${w.exitCode}`}` };
    return { changed: true, data: { dest, assembled: files.length }, msg: `assemble: ${files.length} file(s) -> ${dest}` };
  },
};

/** Search metadata for the `assemble` module. */
export const meta: ModuleSummary = {
  name: "assemble",
  description: "Concatenate files from a remote directory into one file (Ansible `assemble` alternate). Reads each matching file on the target and writes the concatenation to `dest`.",
  source: "builtin",
  args: {
    src: { type: "string", required: true, description: "Remote directory to read parts from." },
    dest: { type: "string", required: true, description: "Remote destination file." },
    regexp: { type: "string", required: false, description: "Only include filenames matching this regex." },
  },
  examples: [
    `- assemble:
    src: /etc/nginx/conf.d
    dest: /etc/nginx/nginx.conf.assembled
    regexp: '.*\.conf$'`,
  ],
  notes: "≠ Ansible `assemble`: `remote_src` is always true (RoleCall reads from the target); files are concatenated in sorted filename order. No `delimiter` insertion between parts yet.",
};

(assembleModule as Module & { meta: ModuleSummary }).meta = meta;
export default assembleModule;
