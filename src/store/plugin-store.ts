// Plugin SDK storage layer (Wave 2 module-parity increment).
//
// Persists user-registered plugin manifest entries as JSON under a `.rolecall`
// directory: project-local `<root>/.rolecall/plugins.json` (takes precedence) and the
// global `~/.rolecall/plugins.json` (fallback when no project entry exists). Plain
// fs + JSON — no new dependency, consistent with the existing SQLite store's
// `.rolecall` convention. The CLI `plugin register`/`list` commands and the startup
// auto-loader consume this.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { VarManifestEntry } from "../config/var-manifest/types";

/** A registered plugin: a module (has a `run`) or a fact-only declaration. */
export type PluginType = "module" | "fact";

/** @summary A single persisted plugin manifest entry. @property type Whether this is a module plugin or a fact-only declaration. @property name Registered name (matches the module's `name`). @property path Absolute or cwd-relative path to the module/fact source file. @property declaredFacts Fact schemas the plugin declares (wired into `var_strict` when present). */
export interface PluginManifestEntry {
  type: PluginType;
  name: string;
  path: string;
  declaredFacts?: VarManifestEntry[];
}

export interface PluginStoreOptions {
  /** Project root; its `.rolecall/plugins.json` takes precedence. Defaults to cwd. */
  root?: string;
  /** Global home root; defaults to `$ROLECALL_HOME` or `~/.rolecall`. */
  globalRoot?: string;
}

/** @summary Resolve the global RoleCall home directory (`$ROLECALL_HOME`, else `~/.rolecall`). */
export function globalRolecallDir(): string {
  return process.env.ROLECALL_HOME ? join(process.env.ROLECALL_HOME, ".rolecall") : join(homedir(), ".rolecall");
}

function manifestPath(root: string): string {
  return join(root, ".rolecall", "plugins.json");
}

function readManifest(root: string): PluginManifestEntry[] {
  const p = manifestPath(root);
  if (!existsSync(p)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(p, "utf8"));
    return Array.isArray(parsed) ? (parsed as PluginManifestEntry[]) : [];
  } catch {
    return [];
  }
}

function writeManifest(root: string, entries: PluginManifestEntry[]): void {
  const p = manifestPath(root);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(entries, null, 2), "utf8");
}

/** @summary Register (or overwrite) a plugin entry, persisting it to the project-local `.rolecall/plugins.json` (or global when `globalRoot` is given and `root` is not). @param entry The plugin manifest entry to persist. @param opts Storage roots; `root` wins, then `globalRoot`, then cwd. @returns The persisted entry. */
export function registerPlugin(entry: PluginManifestEntry, opts: PluginStoreOptions = {}): PluginManifestEntry {
  const root = opts.root ?? opts.globalRoot ?? process.cwd();
  const entries = readManifest(root).filter(
    (e) => !(e.name === entry.name && e.type === entry.type),
  );
  entries.push(entry);
  writeManifest(root, entries);
  return entry;
}

/** @summary List merged plugin entries: project-local overrides global by (name, type). Tolerant of missing files. @param opts Storage roots. @returns Sorted, de-duplicated entries. */
export function listPlugins(opts: PluginStoreOptions = {}): PluginManifestEntry[] {
  const project = readManifest(opts.root ?? process.cwd());
  const global = readManifest(opts.globalRoot ?? globalRolecallDir());
  const byKey = new Map<string, PluginManifestEntry>();
  for (const e of global) byKey.set(`${e.type}:${e.name}`, e);
  for (const e of project) byKey.set(`${e.type}:${e.name}`, e);
  return [...byKey.values()].sort((a, b) =>
    a.name.localeCompare(b.name) || a.type.localeCompare(b.type),
  );
}

/** @summary Entries that should be auto-loaded at CLI startup (project + global merged). */
export function resolvePluginsForLoad(opts: PluginStoreOptions = {}): PluginManifestEntry[] {
  return listPlugins(opts);
}

/** @summary Remove a registered plugin entry by (name, type). @returns True if an entry was removed. */
export function removePlugin(
  name: string,
  type: PluginType = "module",
  opts: PluginStoreOptions = {},
): boolean {
  const root = opts.root ?? opts.globalRoot ?? process.cwd();
  const before = readManifest(root);
  const after = before.filter((e) => !(e.name === name && e.type === type));
  if (after.length === before.length) return false;
  writeManifest(root, after);
  return true;
}
