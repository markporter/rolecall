// Fast templating — eta compile-to-JS with per-source caching.
//
// ENGINE CHOICE: `eta` (preferred per the task). The `vento` package listed in
// package.json is NOT the templating engine — it is an unrelated "event
// superclass" npm package (v2.1.1, description "An event superclass for automatic
// method generation"). The real templating vento is published as `ventojs`, which
// is not installed. So eta is used; it compiles a template string to a JS
// function ONCE and we cache that function keyed by the template source so
// repeated renders reuse it (CPU-bound compile cost paid a single time).
//
// LENIENT BY DEFAULT (H4 review fix, decisions.md #5): vault / secret placeholders
// TODO(ROLECALL-PLACEHOLDER): Jinja vault/secret resolution deferred to server layer
// are deferred to the server layer, so rendering a template that references an
// UNDEFINED variable MUST NOT throw. Missing top-level vars render as ""; missing
// nested paths (e.g. `a.b.c` where `a` is absent) also render as "" and do not
// throw. This is intentional — see learnings.md / decisions.md.
//
// FILTERS: `{{ name(arg) }}` calls a filter registered via the shared registry
// (`./filters.ts`). The registry is the single source of truth shared with Todo 7.

import { Eta, type TemplateFunction } from "eta";
import { getFilter, hasFilter } from "./filters.js";

// eta-internal free-variable bindings emitted inside `with(it){ ... }`. These must
// resolve to the REAL function scope, not the data proxy — if the proxy scopes
// them they break (`__eta`, `it`, `options`, ...). Vars/filters win over these.
const ENGINE_INTERNAL = new Set<string>([
  "__eta",
  "include",
  "includeAsync",
  "output",
  "capture",
  "captureAsync",
  "block",
  "blockAsync",
  "layout",
  "it",
  "options",
]);

// Lenient nil returned for missing variables. Safe for nested property access
// (returns itself) and string coercion (returns ""), so `a.b.c` where `a` is
// absent does not throw and renders as "".
const LENIENT_NIL: object = new Proxy(
  {
    [Symbol.toPrimitive](): string {
      return "";
    },
    toString(): string {
      return "";
    },
    valueOf(): string {
      return "";
    },
  },
  {
    get(target, key) {
      if (
        key === Symbol.toPrimitive ||
        key === "toString" ||
        key === "valueOf"
      ) {
        return target[key as "toString" | "valueOf" | typeof Symbol.toPrimitive];
      }
      return LENIENT_NIL;
    },
    apply(): typeof LENIENT_NIL {
      return LENIENT_NIL;
    },
    has(): boolean {
      return true;
    },
    construct(): typeof LENIENT_NIL {
      return LENIENT_NIL;
    },
  },
);

// Build the `it` data object as a Proxy that resolves vars, filters, and globals,
// and falls back to LENIENT_NIL for anything undefined (lenient rendering).
function makeData(vars: Record<string, unknown>): object {
  return new Proxy(
    {},
    {
      has(_target, key) {
        if (typeof key !== "string") return false;
        if (Object.prototype.hasOwnProperty.call(vars, key)) return true;
        if (hasFilter(key)) return true;
        if (ENGINE_INTERNAL.has(key)) return false; // resolve to real scope
        return true; // lenient: treat unknown name as a missing var
      },
      get(_target, key) {
        if (typeof key !== "string") return undefined;
        if (Object.prototype.hasOwnProperty.call(vars, key)) return vars[key];
        const filter = getFilter(key);
        if (filter !== undefined) return filter;
        if (typeof globalThis[key as keyof typeof globalThis] !== "undefined") {
          return globalThis[key as keyof typeof globalThis];
        }
        return LENIENT_NIL; // lenient default for missing vars
      },
    },
  );
}

// autoTrim [false, false] keeps whitespace literal; eta's default ("nl") would trim
// newlines after tag-only lines and corrupt config-template fidelity.
const eta = new Eta({ autoEscape: false, useWith: true, autoTrim: [false, false] });

// Cache of compiled template functions keyed by the template source string.
const cache = new Map<string, TemplateFunction>();
let compileCount = 0;

/**
 * Compile a template string to a cached JS function. The function is compiled
 * ONCE per distinct source and reused on subsequent renders (cache hit).
 */
export function compileTemplate(source: string): TemplateFunction {
  const existing = cache.get(source);
  if (existing !== undefined) return existing;
  const fn = eta.compile(source);
  cache.set(source, fn);
  compileCount += 1;
  return fn;
}

/** Return the cached compiled function for a source, or `undefined` if not yet compiled. */
export function getCompiled(source: string): TemplateFunction | undefined {
  return cache.get(source);
}

/** Number of distinct templates compiled so far + current cache size (observability / cache verification). */
export function getTemplateCacheStats(): { size: number; compiles: number } {
  return { size: cache.size, compiles: compileCount };
}

/** Drop all cached compiled functions and reset compile stats (does not touch the filter registry). */
export function clearTemplateCache(): void {
  cache.clear();
  compileCount = 0;
}

/**
 * Render `template` with `vars`, returning deterministic output. The template is
 * compiled once and cached by source. Undefined variables render leniently as ""
 * TODO(ROLECALL-PLACEHOLDER): Jinja vault/secret resolution deferred to server layer
 * and never throw (vault/secret placeholders are deferred to the server layer).
 */
export function render(
  template: string,
  vars: Record<string, unknown> = {},
): string {
  const fn = compileTemplate(template);
  return fn.call(eta, makeData(vars), {}) as string;
}
