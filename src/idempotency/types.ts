// Idempotency layer types + hashing helpers (Todo 13).
//
// Consumes the Module/ModuleContext/ModuleResult contract from
// ../executor/module (read-only — module.ts is NOT modified). The optional
// `check` augmentation is read off the module object at runtime; it is defined
// here as a local augmented type, never added to module.ts.

import type { Module, ModuleContext, ModuleResult } from "../executor/module";

/** A single cached idempotency record. */
export interface CacheEntry {
  observed: unknown;
  appliedAt: number;
}

/** Pluggable cache backing the skip-unchanged fast-path. */
export interface IdempotencyCache {
  get(key: string): Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry): Promise<void>;
  has(key: string): Promise<boolean>;
  close(): void;
}

/** Options controlling idempotent application. */
export interface IdempotencyOptions {
  /** Cache used for the skip-unchanged fast-path. When absent, modules run directly. */
  cache?: IdempotencyCache;
  /** Bypass the cache and force a full apply. */
  force?: boolean;
  /**
   * When true, a cache hit short-circuits with no observe pass. Default FALSE:
   * every run performs a fresh observe-and-reconcile.
   */
  rolecallManagedOnly?: boolean;
}

/** A module that can report its current state for declarative reconciliation. */
export interface CheckableModule extends Module {
  check?(
    args: Record<string, unknown>,
    ctx: ModuleContext,
  ): Promise<{ current: unknown; inDesired: boolean }>;
}

/** A module whose `run` inherently mutates (shell/command/http-post). */
export interface SideEffectingModule extends Module {
  readonly sideEffecting: true;
}

/** Result of an idempotent apply (extends ModuleResult with cache metadata). */
export interface IdempotentResult extends ModuleResult {
  /** True when the apply was skipped due to a cache hit (rolecall_managed_only). */
  cacheHit?: boolean;
  /** True when skipped because the observed state was already desired. */
  skippedUnchanged?: boolean;
}

/** Recursively sort object keys for a deterministic serialization. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** Stable JSON stringify with sorted keys (deterministic across runtimes). */
export function normalizeArgs(args: Record<string, unknown>): string {
  return JSON.stringify(sortKeys(args));
}

type DigestInput = Parameters<typeof crypto.subtle.digest>[1];

/** Web Crypto SHA-256 hex digest (deterministic across runtimes). */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data as DigestInput);
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Composite cache key: host|module|sha256(normalizedDesiredBlock). */
export async function computeCacheKey(
  host: string,
  moduleName: string,
  desired: Record<string, unknown>,
): Promise<string> {
  const hash = await sha256Hex(normalizeArgs(desired));
  return `${host}|${moduleName}|${hash}`;
}
