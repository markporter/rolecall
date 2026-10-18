import { VarManifestError } from "./errors.js";
import type { VarManifestEntry } from "./types.js";

/** A per-var conflict found while merging layered declarations. */
export interface MergeConflict {
  /** Var name shared by the conflicting declarations. */
  name: string;
  /** Human-readable reasons the declarations disagree on shape. */
  reasons: string[];
}

/** @summary Reasons two declarations of the same var disagree on shape (hard-fail contract). */
function shapeConflicts(a: VarManifestEntry, b: VarManifestEntry): string[] {
  const problems: string[] = [];
  if (JSON.stringify(a.type) !== JSON.stringify(b.type)) {
    problems.push(`type ${JSON.stringify(a.type)} vs ${JSON.stringify(b.type)}`);
  }
  if (a.source !== b.source) {
    problems.push(`source ${a.source} vs ${b.source}`);
  }
  if ((a.required ?? false) !== (b.required ?? false)) {
    problems.push(`required ${a.required ?? false} vs ${b.required ?? false}`);
  }
  if ((a.nullable ?? false) !== (b.nullable ?? false)) {
    problems.push(`nullable ${a.nullable ?? false} vs ${b.nullable ?? false}`);
  }
  return problems;
}

/**
 * @summary Merge layered var-manifest entries into one authoritative, de-duplicated
 * registry. Entries are layered in ascending precedence order (e.g. role → playbook);
 * a later entry's declared `default` overrides an earlier one, but conflicting *shape*
 * declarations (type/source/required/nullable) across layers are a hard fail.
 * @param entries Layered declarations in ascending precedence order.
 * @returns De-duplicated merged entries (one authoritative entry per var name).
 * @throws {VarManifestError} When two declarations of the same var disagree on shape.
 */
export function mergeManifests(entries: ReadonlyArray<VarManifestEntry>): VarManifestEntry[] {
  const byName = new Map<string, VarManifestEntry>();
  const conflicts: MergeConflict[] = [];

  for (const entry of entries) {
    const existing = byName.get(entry.name);
    if (existing === undefined) {
      byName.set(entry.name, entry);
      continue;
    }
    const reasons = shapeConflicts(existing, entry);
    if (reasons.length > 0) {
      conflicts.push({ name: entry.name, reasons });
      continue;
    }
    // Shape agrees: a later non-undefined default wins (higher precedence layer).
    if (entry.default !== undefined) {
      byName.set(entry.name, { ...existing, default: entry.default });
    }
  }

  if (conflicts.length > 0) {
    const detail = conflicts
      .map((c) => `var '${c.name}': ${c.reasons.join("; ")}`)
      .join("\n");
    throw new VarManifestError(`conflicting var declarations:\n${detail}`);
  }

  return [...byName.values()];
}
