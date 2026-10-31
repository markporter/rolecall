// Built-in module: `find` — Ansible `find` alternate (search the target filesystem).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

type AgeUnit = "s" | "m" | "h" | "d" | "w";

/** @summary Parse an Ansible-style relative age (`[+-]?<n><s|m|h|d|w>`). @param value Raw `age` argument. @returns Parsed sign/count/unit, or undefined when the value is not a valid age. */
function parseAge(value: string): { sign: "+" | "-" | ""; n: number; unit: AgeUnit } | undefined {
  const m = /^([+-]?)(\d+)([smhdw])$/.exec(value.trim());
  if (!m) return undefined;
  const sign = m[1] === "+" || m[1] === "-" ? m[1] : "";
  return { sign, n: Number.parseInt(m[2] as string, 10), unit: m[3] as AgeUnit };
}

/** @summary Build the GNU `find` time predicate for an age and timestamp selector. `d`/`w` map to `<stamp>time` (days); `h`/`m`/`s` map to `<stamp>min` (minutes, seconds rounded up). @param age Parsed age. @param stampTimestamp atime/ctime/mtime. @returns Predicate string such as `-mtime +2` or `-mmin 180`. */
function agePredicate(
  age: { sign: "+" | "-" | ""; n: number; unit: AgeUnit },
  stampTimestamp: "atime" | "ctime" | "mtime",
): string {
  const stamp = stampTimestamp === "atime" ? "a" : stampTimestamp === "ctime" ? "c" : "m";
  if (age.unit === "d" || age.unit === "w") {
    const days = age.unit === "w" ? age.n * 7 : age.n;
    return `-${stamp}time ${age.sign}${days}`;
  }
  const minutes = age.unit === "h" ? age.n * 60 : age.unit === "m" ? age.n : Math.ceil(age.n / 60);
  return `-${stamp}min ${age.sign}${minutes}`;
}

/** @summary Search the target filesystem for files/dirs (Ansible `find` alternate). Returns matching entries with per-file stat in `data.files`. @param ctx ModuleContext carrying `paths`, `pattern`, `file_type`, `recurse`, `depth`, `use_regex`, `hidden`, `size`, `age`, `age_stamp`, `contains`. @returns ModuleResult with the match list in `data`. */
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
    const size = typeof a["size"] === "string" ? String(a["size"]).trim() : "";
    const age = typeof a["age"] === "string" ? String(a["age"]).trim() : "";
    const ageStamp =
      a["age_stamp"] === "atime" || a["age_stamp"] === "ctime" ? a["age_stamp"] : "mtime";
    const contains = typeof a["contains"] === "string" ? String(a["contains"]) : "";

    const opts: string[] = [];
    if (fileType === "file") opts.push("-type f");
    else if (fileType === "directory") opts.push("-type d");
    else if (fileType === "link") opts.push("-type l");
    if (size) opts.push(`-size ${size}`);
    if (age) {
      const parsed = parseAge(age);
      if (!parsed) {
        return {
          changed: false,
          failed: true,
          msg: `find: invalid age '${age}' (expected e.g. '+2d', '-12h', '30m')`,
        };
      }
      opts.push(agePredicate(parsed, ageStamp));
    }
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
    let files = (res.stdout ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((line) => {
        const [path, sizeField, mtime, type, mode] = line.split("\t");
        return {
          path: path ?? "",
          size: sizeField ? Number(sizeField) : 0,
          mtime: mtime ? Number(mtime) : 0,
          type: typeName(type ?? ""),
          mode: mode ?? "",
        };
      });

    if (contains) {
      const sudo = ctx.become ? "sudo " : "";
      const kept: typeof files = [];
      for (const file of files) {
        if (file.type !== "file") continue;
        const g = await ctx.connection.exec(`${sudo}grep -q -E ${shQuote(contains)} ${shQuote(file.path)}`);
        if (g.exitCode === 0) kept.push(file);
      }
      files = kept;
    }

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
    file_type: { type: "file | directory | link | any", required: false, description: "Filter by type (default any)." },
    recurse: { type: "boolean", required: false, description: "Descend into subdirectories (default true)." },
    depth: { type: "number", required: false, description: "Max search depth." },
    use_regex: { type: "boolean", required: false, description: "Treat `pattern` as a regex." },
    hidden: { type: "boolean", required: false, description: "Include dotfiles (default false).", },
    size: { type: "string", required: false, description: "GNU `find -size` filter, e.g. `+10M`, `-1k`, `10G`." },
    age: { type: "string", required: false, description: "Relative age filter, e.g. `+2d`, `-12h`, `30m`." },
    age_stamp: { type: "atime | ctime | mtime", required: false, description: "Timestamp the `age` filter measures (default mtime)." },
    contains: { type: "string", required: false, description: "Keep only regular files whose contents match this regex." },
  },
  examples: [
    `- find:
    paths: /etc
    pattern: "*.conf"
    recurse: true`,
    `- find:
    paths: /var/log
    file_type: file
    size: +10M
    age: +2d
    age_stamp: mtime
    contains: "ERROR"
  register: stale_logs`,
  ],
  notes: "≠ Ansible `find`: returns a list of dicts ({path,size,mtime,type,mode}) rather than full `stat`. GNU `find -printf` required. `size` passes through to `find -size`; `age`+`age_stamp` map to `-mtime`/`-atime`/`-ctime` (d/w) or `-mmin`/`-amin`/`-cmin` (h/m/s); `contains` post-filters regular files with `grep -q -E`.",
};

(findModule as Module & { meta: ModuleSummary }).meta = meta;
export default findModule;
