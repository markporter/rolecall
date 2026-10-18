// Project/role plugin scanner (ADR 0014 work item 1).
//
// Pure-filesystem discovery of plugins laid out as:
//
//   <root>/plugins/<type>/<namespace>/<name>.{ts,js}
//   <root>/collections/<org>/<coll>/plugins/<type>/<namespace>/<name>.{ts,js}
//
// The FQCN is derived from the path: `<namespace>.<name>`; the plugin TYPE is the
// directory segment immediately after a `plugins` segment (NOT part of the FQCN).
// No module loading happens here — this only enumerates files and derives names.
//
// Symlink cycles are guarded with a `realpathSync` visited set; `node_modules`
// and `.git` are skipped so dependency trees are never scanned.

import { readdirSync, statSync, realpathSync, type Dirent } from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** The five plugin-type directory segments (ADR 0014 §2). */
export type PluginType =
  | "modules"
  | "connection_types"
  | "callbacks"
  | "inventory"
  | "facts";

/** One discovered plugin file. */
export interface PluginScanEntry {
  /** Fully-qualified name `<namespace>.<name>` (type is NOT included). */
  fqcn: string;
  /** The `<namespace>` directory segment (the collection unit). */
  namespace: string;
  /** The bare file name (without extension). */
  name: string;
  /** The plugin type, inferred from the directory. */
  type: PluginType;
  /** Absolute path to the source file. */
  filePath: string;
}

const PLUGIN_TYPES: readonly PluginType[] = [
  "modules",
  "connection_types",
  "callbacks",
  "inventory",
  "facts",
];

const MODULE_EXTENSIONS = new Set([".ts", ".mts", ".js", ".mjs"]);

/** Directories never descended into during a scan. */
const SKIP_DIRS = new Set(["node_modules", ".git", ".rolecall"]);

/**
 * Recursively collect every file beneath `dir`, guarding against symlink cycles
 * via a `realpathSync` visited set. Symlinked directories are resolved with
 * `statSync` before descending; symlinked files are collected directly.
 * @param dir Directory to walk.
 * @param visited Set of already-visited realpaths (cycle guard).
 * @param out Accumulator of absolute file paths.
 */
function walk(dir: string, visited: Set<string>, out: string[]): void {
  let real: string;
  try {
    real = realpathSync(dir);
  } catch {
    return; // unreadable / broken symlink
  }
  if (visited.has(real)) return;
  visited.add(real);

  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable directory
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full, visited, out);
      else if (st.isFile()) out.push(full);
    } else if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, visited, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
}

/**
 * Scan a project root for plugins. Enumerates every `plugins/<type>/<namespace>/<name>`
 * location (including `collections/<org>/<coll>/plugins/...`) and derives each entry's FQCN
 * from its path. Pure filesystem — performs no module loading.
 * @param opts.root Project root to scan (resolved against cwd when relative).
 * @param opts.types Optional type filter; when omitted all five types are scanned.
 * @returns Discovered plugin entries (FQCNs normalized to posix).
 */
export function scanProject(opts: { root: string; types?: PluginType[] }): PluginScanEntry[] {
  const root = isAbsolute(opts.root) ? opts.root : resolve(process.cwd(), opts.root);
  const wanted = opts.types ? new Set(opts.types) : null;

  const files: string[] = [];
  walk(root, new Set<string>(), files);

  const entries: PluginScanEntry[] = [];
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (!MODULE_EXTENSIONS.has(ext)) continue;

    const rel = relative(root, file).split(sep).join("/");
    const segments = rel.split("/");
    const pluginsIdx = segments.indexOf("plugins");
    if (pluginsIdx < 0) continue;

    const typeSeg = segments[pluginsIdx + 1];
    if (!typeSeg || !PLUGIN_TYPES.includes(typeSeg as PluginType)) continue;
    if (wanted && !wanted.has(typeSeg as PluginType)) continue;

    const namespace = segments[pluginsIdx + 2];
    if (!namespace) continue;

    const name = basename(file, ext);
    const fqcn = `${namespace}.${name}`;
    entries.push({
      fqcn,
      namespace,
      name,
      type: typeSeg as PluginType,
      filePath: file,
    });
  }
  return entries;
}
