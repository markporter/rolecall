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
import { ANSIBLE_FILTERS, ANSIBLE_GLOBALS, ANSIBLE_TESTS } from "./ansible-filters.js";

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

// Eta is executable JavaScript. Do not expose arbitrary host globals to a
// template; only this allow-list of pure built-ins is available. The sandbox
// worker also has no network/project mounts, but removing `process`/`require`/
// `Bun`/`fetch` here hardens in-process rendering too.
const SAFE_GLOBALS = new Map<string, unknown>(
  Object.entries({ JSON, Math, Date, Number, String, Boolean, Object, Array, RegExp, parseInt, parseFloat, isNaN }),
);

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

// Shared Ansible filter/test/global views for ADR 0031 Eta codegen. User vars
// still win because `makeData` checks the data object first. Filters/tests unwrap
// the lenient missing-value proxy so Ansible `default`/`defined` see `undefined`.
type AnyFilter = (value: unknown, ...args: unknown[]) => unknown;
const unwrapLenient = (value: unknown): unknown => (value === LENIENT_NIL ? undefined : value);
const wrapFilter = (filter: AnyFilter): AnyFilter =>
  (value, ...args) => filter(unwrapLenient(value), ...args.map(unwrapLenient));


// Small built-in filter set used by ADR 0031 codegen. These mirror the Nunjucks
// filters the analyzer classifies as mapped; keep this list in sync with
// `BUILTIN_FILTERS` in src/convert/templates.ts.
const BUILTIN_FILTER_IMPLS: Record<string, AnyFilter> = {
  join: (value, sep = "") => (Array.isArray(value) ? value.join(String(sep ?? "")) : String(value ?? "")),
  length: (value) =>
    Array.isArray(value) || typeof value === "string"
      ? value.length
      : value !== null && typeof value === "object"
        ? Object.keys(value).length
        : 0,
  upper: (value) => String(value ?? "").toUpperCase(),
  lower: (value) => String(value ?? "").toLowerCase(),
  capitalize: (value) => {
    const text = String(value ?? "");
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  },
  title: (value) =>
    String(value ?? "").replace(/\w\S*/g, (word) => word[0]!.toUpperCase() + word.slice(1).toLowerCase()),
  trim: (value) => String(value ?? "").trim(),
  replace: (value, from, to) => String(value ?? "").split(String(from)).join(String(to)),
  first: (value) => (Array.isArray(value) ? value[0] : typeof value === "string" ? value[0] : undefined),
  last: (value) =>
    Array.isArray(value) ? value[value.length - 1] : typeof value === "string" ? value[value.length - 1] : undefined,
  reverse: (value) =>
    Array.isArray(value) ? [...value].reverse() : String(value ?? "").split("").reverse().join(""),
  sort: (value) => (Array.isArray(value) ? [...value].sort() : value),
  list: (value) =>
    Array.isArray(value) ? value : typeof value === "string" ? value.split("") : Object.values(value ?? {}),
  string: (value) => String(value ?? ""),
  int: (value) => Number.parseInt(String(value ?? ""), 10) || 0,
  float: (value) => Number.parseFloat(String(value ?? "")) || 0,
  abs: (value) => Math.abs(Number(value)),
  round: (value, precision = 0) => {
    const factor = 10 ** Number(precision);
    return Math.round(Number(value) * factor) / factor;
  },
  sum: (value) => (Array.isArray(value) ? value : []).reduce<number>((sum, item) => sum + Number(item), 0),
  unique: (value) => Array.from(new Set(Array.isArray(value) ? value : [])),
  min: (value) => Math.min(...(Array.isArray(value) ? value.map(Number) : [])),
  max: (value) => Math.max(...(Array.isArray(value) ? value.map(Number) : [])),
  slice: (value, start, end) =>
    Array.isArray(value)
      ? value.slice(Number(start ?? 0), end === undefined ? undefined : Number(end))
      : String(value ?? "").slice(Number(start ?? 0), end === undefined ? undefined : Number(end)),
  batch: (value, size) => {
    const input = Array.isArray(value) ? value : [];
    const width = Math.max(1, Number(size));
    const out: unknown[][] = [];
    for (let i = 0; i < input.length; i += width) out.push(input.slice(i, i + width));
    return out;
  },
  safe: (value) => value,
  escape: (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
    ),
  tojson: (value) => JSON.stringify(value),
  dump: (value) => JSON.stringify(value),
};

const FILTER_VIEW = new Proxy(
  {},
  {
    has() {
      return true;
    },
    get(_target, key) {
      if (typeof key !== "string") return undefined;
      const shared = getFilter(key);
      if (shared !== undefined) return shared;
      const filter = ANSIBLE_FILTERS[key] ?? BUILTIN_FILTER_IMPLS[key];
      return filter === undefined ? undefined : wrapFilter(filter);
    },
  },
);

const TEST_VIEW = new Proxy(
  {},
  {
    has() {
      return true;
    },
    get(_target, key) {
      if (typeof key !== "string") return undefined;
      const test = ANSIBLE_TESTS[key];
      return test === undefined ? undefined : wrapFilter(test);
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
        if (key === "filters" || key === "tests" || key === "globals") return true;
        if (hasFilter(key)) return true;
        if (ENGINE_INTERNAL.has(key)) return false; // resolve to real scope
        return true; // lenient: treat unknown name as a missing var
      },
      get(_target, key) {
        if (typeof key !== "string") return undefined;
        if (Object.prototype.hasOwnProperty.call(vars, key)) return vars[key];
        if (key === "filters") return FILTER_VIEW;
        if (key === "tests") return TEST_VIEW;
        if (key === "globals") return ANSIBLE_GLOBALS;
        const shared = getFilter(key);
        if (shared !== undefined) return shared;
        const ansible = ANSIBLE_FILTERS[key] ?? BUILTIN_FILTER_IMPLS[key];
        if (ansible !== undefined) return wrapFilter(ansible);
        if (Object.prototype.hasOwnProperty.call(ANSIBLE_GLOBALS, key)) return ANSIBLE_GLOBALS[key];
        if (SAFE_GLOBALS.has(key)) return SAFE_GLOBALS.get(key);
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
