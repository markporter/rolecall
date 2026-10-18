// FQCN module resolver + project scanner wiring (ADR 0014 work item 2).
//
// Layers an FQCN-aware resolution table on top of the existing bare-name registry
// (`src/executor/module.ts`). The registry is preserved as the builtin + `plugin
// register` store (keyed by bare name). Scanned project plugins are resolved by
// FQCN (or by an unambiguous bare alias) and are NEVER written into the bare
// registry, so they cannot silently clobber a builtin.
//
// `resolveModule` is SYNCHRONOUS: scanned modules are eagerly loaded once at
// playbook startup (via `scanAndRegister`), so the dispatch path never performs a
// dynamic import.

import { getModule, listModules, type Module } from "../executor/module";
import { importModuleObject } from "./loader";
import { registerFactPlugin } from "../facts/engine";
import { scanProject, type PluginScanEntry, type PluginType } from "./scanner";
export { scanProject } from "./scanner";

/** Result of resolving a module reference. */
export type ResolveResult =
  | { kind: "module"; module: Module; fqcn: string; entry: PluginScanEntry | null }
  | { kind: "notFound"; spec: string }
  | { kind: "ambiguous"; spec: string; candidates: string[] };

/**
 * Thrown when a bare module reference is ambiguous (maps to more than one FQCN).
 * Reserved for future callers that prefer throwing over the `ambiguous`
 * {@link ResolveResult}; today ambiguity is surfaced as a resolve result so the
 * executor can report it through its existing failure path.
 */
export class ModuleCollisionError extends Error {
  /** The ambiguous bare reference. */
  public readonly spec: string;
  /** The FQCNs the bare reference could resolve to. */
  public readonly candidates: string[];
  constructor(spec: string, candidates: string[]) {
    super(
      `ambiguous module reference '${spec}': ${candidates.join(", ")} — use the fully-qualified name`,
    );
    this.name = "ModuleCollisionError";
    this.spec = spec;
    this.candidates = candidates;
  }
}

/** A resolved plugin: its scan entry plus the eagerly-loaded module (modules type). */
interface ResolvedEntry {
  entry: PluginScanEntry;
  module: Module | null;
}

// NOTE (ADR 0014): these three tables are PROCESS-GLOBAL and single-scan by
// design. `scanAndRegister` clears+rebuilds them once per `playbook run`; the CLI
// is one-shot, so this is safe today. A future `--serve` that routes playbook runs
// through `runPlaybookCommand` would scan concurrently and race — scope the table
// per-run (pass via context) before wiring serve to run playbooks.
/** Per-type map of FQCN → resolved entry. */
const resolutionByType = new Map<PluginType, Map<string, ResolvedEntry>>();
/** Per-type map of bare name → single FQCN (builtin-reserved names are excluded). */
const bareAliasByType = new Map<PluginType, Map<string, string>>();
/** Per-type set of bare names that map to more than one FQCN (ambiguous). */
const ambiguousBareByType = new Map<PluginType, Set<string>>();

/** Builtin/collection prefixes that strip down to a bare builtin lookup. */
const BUILTIN_PREFIXES = ["rolecall.builtin.", "ansible.builtin."];

/**
 * Resolve a module reference to a {@link ResolveResult}.
 *
 * Resolution order (modules type):
 *  1. `rolecall.builtin.*` / `ansible.builtin.*` → strip prefix, bare builtin lookup.
 *  2. A spec containing `.` is treated as an FQCN → table lookup.
 * 3. A bare spec → reserved builtin/registry name, then an unambiguous bare alias,
 *     then an `ambiguous` result when the bare name maps to >1 FQCN, else `notFound`.
 *
 * The bare registry (`getModule`) is consulted for bare specifiers AND as the
 * fallback for dotted specifiers the scan table does not contain, so resolution
 * matches the pre-0014 dispatch for registered modules regardless of whether
 * `scanAndRegister` has run.
 * @param spec The module reference from a task (`module:` field).
 * @returns A {@link ResolveResult} describing the outcome.
 */
export function resolveModule(spec: string): ResolveResult {
  if (!spec) return { kind: "notFound", spec };

  for (const prefix of BUILTIN_PREFIXES) {
    if (spec.startsWith(prefix)) {
      const bare = spec.slice(prefix.length);
      const mod = getModule(bare);
      return mod
        ? { kind: "module", module: mod, fqcn: spec, entry: null }
        : { kind: "notFound", spec };
    }
  }

  const modules = resolutionByType.get("modules");

  // FQCN reference (contains a dot, e.g. `myorg.firewall`).
  if (spec.includes(".")) {
    const resolved = modules?.get(spec);
    if (resolved && resolved.module) {
      return { kind: "module", module: resolved.module, fqcn: spec, entry: resolved.entry };
    }
    const registered = getModule(spec);
    if (registered) return { kind: "module", module: registered, fqcn: spec, entry: null };
    return { kind: "notFound", spec };
  }

  // Bare reference — reserved builtin/registry name wins first.
  const builtin = getModule(spec);
  if (builtin) return { kind: "module", module: builtin, fqcn: spec, entry: null };

  // Ambiguous bare reference (maps to more than one FQCN).
  const ambiguous = ambiguousBareByType.get("modules");
  if (ambiguous?.has(spec)) {
    const candidates = [...(modules?.values() ?? [])]
      .filter((r) => r.entry.name === spec)
      .map((r) => r.entry.fqcn);
    return { kind: "ambiguous", spec, candidates };
  }

  // Unambiguous bare alias → its single FQCN.
  const alias = bareAliasByType.get("modules")?.get(spec);
  if (alias) {
    const resolved = modules?.get(alias);
    if (resolved && resolved.module) {
      return { kind: "module", module: resolved.module, fqcn: alias, entry: resolved.entry };
    }
  }

  return { kind: "notFound", spec };
}

/**
 * Build the resolution tables from scanned entries. Names that collide with a
 * reserved bare name (`builtinNames`) are excluded from the bare-alias map so the
 * builtin keeps the bare alias; the user plugin remains reachable only by FQCN.
 * Ambiguity (a bare name mapping to >1 FQCN) is recorded but NOT an error here —
 * it is surfaced at resolve time.
 * @param entries Scanned plugin entries (pure FS; modules are attached separately).
 * @param builtinNames Reserved bare names that win the bare alias (builtins + registered plugins).
 */
export function buildResolutionTable(
  entries: PluginScanEntry[],
  builtinNames: Set<string>,
): void {
  resolutionByType.clear();
  bareAliasByType.clear();
  ambiguousBareByType.clear();

  for (const entry of entries) {
    let byFqcn = resolutionByType.get(entry.type);
    if (!byFqcn) {
      byFqcn = new Map();
      resolutionByType.set(entry.type, byFqcn);
    }
    const prior = byFqcn.get(entry.fqcn);
    if (prior) {
      process.stderr.write(
        `warn: duplicate plugin FQCN '${entry.fqcn}' (${entry.filePath}) overrides ${prior.entry.filePath}\n`,
      );
    }
    byFqcn.set(entry.fqcn, { entry, module: null });

    // Reserved bare names keep the builtin alias; user plugin is FQCN-only.
    if (builtinNames.has(entry.name)) continue;

    let aliases = bareAliasByType.get(entry.type);
    if (!aliases) {
      aliases = new Map();
      bareAliasByType.set(entry.type, aliases);
    }
    const existing = aliases.get(entry.name);
    if (existing === undefined) {
      aliases.set(entry.name, entry.fqcn);
    } else if (existing !== entry.fqcn) {
      let ambiguous = ambiguousBareByType.get(entry.type);
      if (!ambiguous) {
        ambiguous = new Set();
        ambiguousBareByType.set(entry.type, ambiguous);
      }
      ambiguous.add(entry.name);
    }
  }
}

/**
 * Scan a project root, build the resolution table, and eagerly load every
 * discovered `modules` plugin exactly once. Scanned modules are NOT written into
 * the bare registry (no silent clobber); those declaring `facts` are wired into
 * the fact engine under their FQCN. A single bad plugin is warned and skipped so
 * one broken file never aborts startup.
 * @param root Project root to scan (resolved against cwd when relative).
 */
export async function scanAndRegister(root: string): Promise<void> {
  const entries = scanProject({ root });
  const builtinNames = new Set(listModules());
  buildResolutionTable(entries, builtinNames);

  for (const entry of entries) {
    if (entry.type !== "modules") continue;
    try {
      const mod = await importModuleObject(entry.filePath);
      const resolved = resolutionByType.get("modules")?.get(entry.fqcn);
      if (resolved) resolved.module = mod;
      if (mod.facts?.length || mod.factGatherer) {
        registerFactPlugin({
          name: `module:${entry.fqcn}`,
          gatherers: mod.factGatherer ? [mod.factGatherer] : [],
          declares: mod.facts ?? [],
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`warn: failed to load plugin module '${entry.fqcn}': ${msg}\n`);
    }
  }
}
