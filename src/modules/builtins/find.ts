// Built-in module: `find` — Ansible `find` alternate (search the target filesystem).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** @summary Search the target filesystem for files/dirs (Ansible `find` alternate). Returns matching entries with per-file stat in `data.files`. @param ctx ModuleContext carrying `paths`, `pattern`, `file_type`, `recurse`, `depth`, `use_regex`, `hidden`. @returns ModuleResult with the match list in `data`. */
export const findModule: Module = {
  name: "find",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const a = ctx.args;
    const paths = typeof a["paths"] === "string" ? [String(a["paths"])] : Array.isArray(a["paths"]) ? (a["paths"] as unknown[]).map(String) : ["/"];
    const pattern = typeof a["pattern"] === "string" ? String(a["pattern"]) : "";
    const fileType = typeof a["file_type"] === "string" ? String(a["file_type"]) : "any";
    const recurse = a["recurse"] !== false;
    const depth = typeof a["depth"] === "number" ? Number(a["depth"]) : a["depth"] ? Number(a["depth"]) : undefined;
    const useRegex = Boolean(a["use_regex"]);
    const hidden = Boolean(a["hidden"]);

    const opts: string[] = [];
    if (fileType === "file") opts.push("-type f");
    else if (fileType === "directory") opts.push("-type d");
    if (!recurse) opts.push("-maxdepth 1");
    else if (depth !== undefined) opts.push(`-maxdepth ${depth}`);
    if (!hidden) opts.push("-not -name '.*'");
    const pat = pattern ? (useRegex ? `-regex ${shQuote(pattern)}` : `-name ${shQuote(pattern)}`) : "";
    const fmt = "%p\\t%s\\t%Y\\t%y\\t%m";
    const cmd = `find ${paths.map(shQuote).join(" ")} ${opts.join(" ")} ${pat} -printf ${shQuote(fmt)}`.trim();

    const res = await ctx.connection.exec(cmd);
    if (res.exitCode !== 0) return { changed: false, failed: true, msg: `find: failed: ${res.stderr || `exit ${res.exitCode}`}` };
    const typeName = (c: string): string =>
      ({ f: "file", d: "directory", l: "link", c: "character special", b: "block special", p: "fifo", s: "socket" }[c] ?? c);
    const files = (res.stdout ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((line) => {
        const [path, size, mtime, type, mode] = line.split("\t");
        return {
          path: path ?? "",
          size: size ? Number(size) : 0,
          mtime: mtime ? Number(mtime) : 0,
          type: typeName(type ?? ""),
          mode: mode ?? "",
        };
      });
    return { changed: false, data: { files }, msg: `find: ${files.length} match(es)` };
  },
};

/** Search metadata for the `find` module. */
export const meta: ModuleSummary = {
  name: "find",
  description: "Search the target filesystem for files/directories (Ansible `find` alternate). Returns matching paths in `data.files`.",
  source: "builtin",
  args: {
    paths: { type: "string | string[]", required: false, description: "Root path(s) to search (default /)." },
    pattern: { type: "string", required: false, description: "Name (or regex with `use_regex`) pattern." },
    file_type: { type: "file | directory | any", required: false, description: "Filter by type (default any)." },
    recurse: { type: "boolean", required: false, description: "Descend into subdirectories (default true)." },
    depth: { type: "number", required: false, description: "Max search depth." },
    use_regex: { type: "boolean", required: false, description: "Treat `pattern` as a regex." },
    hidden: { type: "boolean", required: false, description: "Include dotfiles (default false).", },
  },
  examples: [
    `- find:
    paths: /etc
    pattern: "*.conf"
    recurse: true`,
  ],
  notes: "≠ Ansible `find`: returns a list of dicts ({path,size,mtime,type,mode}) rather than full `stat`. GNU `find -printf` required. No `size`/`age`/`contains` filters yet.",
};

(findModule as Module & { meta: ModuleSummary }).meta = meta;
export default findModule;
