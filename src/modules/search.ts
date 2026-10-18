// Module discovery + metadata (Todo 27).
//
// The executor registry (`registerModule`/`listModules`) only stores the Module
// object (name + run). To support `searchModules(term)` we keep a parallel,
// optional metadata map keyed by module name. Built-in modules populate it at
// registration time; user plugins fall back to a name-only summary. The metadata
// map is additive — it never alters the Module contract in src/executor/module.

import { listModules } from "../executor/module";

/** Serializable summary of a registered module, returned by `searchModules`. */
export interface ModuleSummary {
  /** Module name (dispatched via `module:` in a task). */
  name: string;
  /** Human-readable one-line description. */
  description: string;
  /** True when the module implements an idempotent `check` (CheckableModule). */
  idempotent?: boolean;
  /** Provenance: "builtin" | "plugin" | "user" | "example". */
  source?: string;
  /** Optional per-argument metadata for the module. */
  args?: Record<string, { type: string; required: boolean; description: string }>;
  /** Optional usage examples (e.g. task snippets). */
  examples?: string[];
  /**
   * Optional "≠ Ansible" callout noting where this module's semantics differ from
   * the Ansible module it most resembles (rendered as a callout block under each
   * module in the generated reference). Omit when there is nothing notable.
   */
  notes?: string;
}

const meta = new Map<string, ModuleSummary>();

/**
 * Attach metadata to a registered module name (idempotent upsert).
 * @param name Module name as registered via `registerModule`.
 * @param summary Partial summary merged over any prior metadata.
 */
export function setModuleMeta(name: string, summary: Partial<ModuleSummary>): void {
  const prev = meta.get(name) ?? { name, description: name };
  meta.set(name, { ...prev, ...summary, name });
}

/**
 * Look up the summary for a single module, falling back to a name-only entry when
 * no metadata has been registered via {@link setModuleMeta}.
 * @param name Module name as registered via `registerModule`.
 * @returns The registered {@link ModuleSummary}, or a name/description-only stub.
 */
export function getModuleSummary(name: string): ModuleSummary {
  return meta.get(name) ?? { name, description: name };
}

/**
 * Filter all registered modules by a substring match against name OR description
 * (case-insensitive). An empty/whitespace `term` returns every module.
 * @param term Search term; matched as a substring of name or description.
 * @returns Serializable summaries, sorted by name for deterministic output.
 */
export function searchModules(term: string): ModuleSummary[] {
  const q = term.trim().toLowerCase();
  const all = listModules().map(getModuleSummary);
  if (!q) return all;
  return all.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      (s.description ?? "").toLowerCase().includes(q),
  );
}
