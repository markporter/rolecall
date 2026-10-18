// Explicit structured reference templating (Todo 24).
//
// This module adds an ALTERNATIVE to `{{ }}` string interpolation using plain
// data *nodes* instead of template strings. Nodes are escapeless (they return raw
// values — never YAML/Jinja-escaped) and type-checked. Three shapes plus two
// control nodes cover the DSL:
//
//   { $var: name }                       single-value lookup (dotted path allowed)
//   { $concat: [ a, "-", b ] }           composite -> joined string of resolved pieces
//   { $call: helper, args: [...] }       invoke a registered helper (real TS fn)
//   { $if: cond, then: x, else: y }      ternary over a boolean predicate
//   { $each: source }                    list source for loops (see expandLoop)
//
// Predicates reuse the SAME node shape so `when` becomes a structured, typed test:
//
//   { $eq: [ { $var: os }, "Debian" ] }
//   { $ne, $lt, $gt, $lte, $gte, $in, $and, $or, $not }
//
// SAFETY CONTRACT: `$var` only reads vars; `$call` only invokes REGISTERED
// helpers (`registerHelper` / passed map); unknown names throw a clean error.
// There is NO eval / new Function here — no ACE surface. Operators are a fixed,
// closed Set, so an unrecognized key fails closed rather than executing anything.

import { pathToFileURL } from "node:url";
import { resolve as pathResolve } from "node:path";
import { render } from "./fast";

/** @summary Callable helper loaded from a project-local TS module; invoked by `$call`. */
export type HelperFn = (...args: any[]) => unknown;

/** @summary Map of helper-name -> callable used to resolve `$call` nodes. */
export type HelpersMap = Record<string, HelperFn>;

/** @summary Any value expressible inside a structured node (scalar | nested node | array). */
export type StructuredValue = unknown;

/** @summary Recognised reference/composite/control operators ($var/$concat/$call/$if/$each/$template). `$fact` was removed by ADR 0013 — facts are reached via `$var: "facts.key"`. */
export const REFERENCE_OPS = new Set<string>(["$var", "$concat", "$call", "$if", "$each", "$template"]);

/** @summary Recognised comparison/logical predicate operators (fail-closed on mismatch). */
export const PREDICATE_OPS = new Set<string>([
  "$eq",
  "$ne",
  "$lt",
  "$gt",
  "$lte",
  "$gte",
  "$in",
  "$and",
  "$or",
  "$not",
]);

/** @summary All first-class structured-node keys ($ref-ops union predicate-ops). */
const KNOWN_OPS = new Set<string>([...REFERENCE_OPS, ...PREDICATE_OPS]);

// ---------------------------------------------------------------------------
// Typed node schemas — these TS interfaces describe the exact shape of every
// structured node. They double as the project's "typed schema" for `when`/`loop`
// / arg values and are what NormalizedTask/NormallizedPlaybook carry.
// ---------------------------------------------------------------------------
/** @summary `{ $var: <name> }` — single-value lookup; `name` supports dotted paths (e.g. `facts.key`, `play.host`). `$fact` was removed by ADR 0013. */
export interface VarNode { $var: string; }
/** @summary `{ $concat: [<operand>, ...] }` — joined string of resolved operands. */
export interface ConcatNode { $concat: StructuredValue[]; }
/** @summary `{ $call: <helperName>, args: [<args>] }` — invoke a registered helper. */
export interface CallNode { $call: string; args?: StructuredValue[]; }
/** @summary `{ condition?, then: x, else: y }` — ternary over a boolean predicate. */
export interface IfNode { condition?: StructuredValue; then: StructuredValue; else: StructuredValue; }
/** @summary `{ $each: <source> }` — list source for loops (literal array or `$var`). */
export interface EachNode { $each: StructuredValue; }
/** @summary `{ $template: "<eta string>" }` — opt-in eta template render of a literal string; the escape hatch for `<%= %>`/`<% %>` syntax. Bare strings are never auto-rendered. */
export interface TemplateNode { $template: string; }
/** @summary Any ref/composite/control node (ADR 0013 removed `FactNode`; facts use `VarNode` with `facts.` paths). */
export type RefNode = VarNode | ConcatNode | CallNode | IfNode | EachNode | TemplateNode;

/** @summary A value usable inside a predicate operand (scalar | nested node | array). */
export type PredicateOperand = StructuredValue;
/** @summary `{ $eq: [a, b] }` — structural equality. */
export interface EqNode { $eq: [PredicateOperand, PredicateOperand]; }
/** @summary `{ $ne: [a, b] }` — negated structural equality. */
export interface NeNode { $ne: [PredicateOperand, PredicateOperand]; }
/** @summary `{ $lt: [a, b] }` — numeric/string less-than (fail-closed on mismatch). */
export interface LtNode { $lt: [PredicateOperand, PredicateOperand]; }
/** @summary `{ $gt: [a, b] }` — numeric/string greater-than. */
export interface GtNode { $gt: [PredicateOperand, PredicateOperand]; }
/** @summary `{ $lte: [a, b] }` — numeric/string less-or-equal. */
export interface LteNode { $lte: [PredicateOperand, PredicateOperand]; }
/** @summary `{ $gte: [a, b] }` — numeric/string greater-or-equal. */
export interface GteNode { $gte: [PredicateOperand, PredicateOperand]; }
/** @summary `{ $in: [element, collection] }` — element belongs to an array/collection. */
export interface InNode { $in: [PredicateOperand, PredicateOperand]; }
/** @summary `{ $and: [<cond>, ...] }` — logical AND. */
export interface AndNode { $and: StructuredValue[]; }
/** @summary `{ $or: [<cond>, ...] }` — logical OR. */
export interface OrNode { $or: StructuredValue[]; }
/** @summary `{ $not: <cond> | [<cond>] }` — logical NOT. */
export interface NotNode { $not: StructuredValue; }
/** @summary Any comparison/logical predicate node. */
export type PredicateNode =
  | EqNode
  | NeNode
  | LtNode
  | GtNode
  | LteNode
  | GteNode
  | InNode
  | AndNode
  | OrNode
  | NotNode;

/** @ summary Value accepted by a `when` guard: legacy scalar or a structured predicate/ref node. */
export type WhenGuard = boolean | number | string | null | undefined | PredicateNode | RefNode;
/** @summary Value accepted by a `loop`: sequence, JSON-string, or a structured `$each` node. */
export type LoopSource = unknown;

/** @summary True when `value` is a structured node object whose every key starts with `$`. */
export function isStructured(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length === 0) return false;
  return keys.every((k) => k.startsWith("$"));
}

/** @summary True when `node` is a recognised predicate operator node. */
export function isPredicate(node: unknown): boolean {
  if (!isStructured(node)) return false;
  const op = Object.keys(node as Record<string, unknown>)[0];
  return op !== undefined && PREDICATE_OPS.has(op);
}

/** @summary True when `node` is a recognised reference/composite/control operator node. */
export function isReferenceNode(node: unknown): boolean {
  if (!isStructured(node)) return false;
  const op = Object.keys(node as Record<string, unknown>)[0];
  return op !== undefined && REFERENCE_OPS.has(op);
}

/**
 * Resolve a dotted variable path against the render scope. Supports the top-level
 * aliases exposed to templates (`host`, `item`, `index`) plus `vars`/`facts`
 * namespaces and arbitrary dotted paths into them. Missing paths yield undefined.
 */
function resolvePath(vars: Record<string, unknown>, name: string): unknown {
  if (typeof name !== "string") return undefined;
  // Top-level scalar aliases resolve directly against the scope object.
  if (!name.includes(".")) {
    if (Object.prototype.hasOwnProperty.call(vars, name)) return (vars as Record<string, unknown>)[name];
  }
  const segments = name.split(".");
  let cur: unknown = vars;
  for (const seg of segments) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** @summary Throw a consistent, actionable error for malformed structured nodes. */
function fail(message: string): never {
  throw new Error(`structured ref: ${message}`);
}

/**
 * Resolve ONE structured node to its raw value. The caller must have already
 * confirmed `node` is a structured node (see {@link isReferenceNode}). Returns the
 * RAW resolved value (escapeless) — objects/arrays pass through untouched.
 */
export function resolveNode(
  node: unknown,
  vars: Record<string, unknown>,
  helpers: HelpersMap = {},
): StructuredValue {
  if (!isStructured(node)) fail("expected a structured node object");
  const record = node as Record<string, unknown>;
  const op = Object.keys(record)[0]!;
  const operand = record[op];
  switch (op) {
    case "$var": {
      if (typeof operand !== "string") fail("$var requires a string variable name");
      return resolvePath(vars, operand);
    }
    case "$concat": {
      if (!Array.isArray(operand)) fail("$concat requires an array of operands");
      return operand.map((v) => String(resolveValue(v, vars, helpers))).join("");
    }
    case "$call": {
      // Shape: { $call: <helperName>, args: [<args>] }  OR  { $call: { call, args } }.
      const spec =
        typeof operand === "object" && operand !== null && !Array.isArray(operand)
          ? (operand as Record<string, unknown>)
          : { call: operand };
      const name =
        typeof spec.call === "string"
          ? spec.call
          : fail("$call requires a helper name ('call')");
      const rawArgs = spec.args ?? [];
      if (!Array.isArray(rawArgs)) fail("$call args must be an array");
      const resolvedArgs = rawArgs.map((a) => resolveValue(a, vars, helpers));
      const fn = lookupHelper(name, helpers);
      if (fn === undefined) fail(`unregistered helper: '${name}' (register it before $call)`);
      return fn(...resolvedArgs);
    }
    case "$if": {
      if (typeof operand !== "object" || operand === null || Array.isArray(operand)) {
        fail("$if expects { then, else } with an optional condition key");
      }
      const block = operand as Record<string, unknown>;
      const cond = block.condition !== undefined
        ? evaluatePredicate(block.condition, vars)
        : true;
      return cond ? resolveValue(block.then, vars, helpers) : resolveValue(block.else, vars, helpers);
    }
    case "$each": {
      // List source for loops; resolves {$var:list} or returns a literal list.
      return resolveValue(operand, vars, helpers);
    }
    case "$template": {
      // Opt-in eta render of a literal string. Works in BOTH legacy and strict
      // modes (it is the structured escape hatch for legacy {{ }}/<% %> syntax).
      if (typeof operand !== "string") fail("$template requires a string template");
      return render(operand, vars);
    }
    default:
      fail(`unknown reference operator '${op}'`);
  }
}

/**
 * Recursively resolve any value: a single structured node, every element of an
 * array, or every entry of a plain data object. Scalars pass through unchanged.
 * This is what threads structured-node resolution through arg values at ANY depth.
 */
export function resolveValue(
  value: StructuredValue,
  vars: Record<string, unknown>,
  helpers: HelpersMap = {},
): StructuredValue {
  if (isStructured(value)) return resolveNode(value, vars, helpers);
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, vars, helpers));
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveValue(v, vars, helpers);
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Predicate evaluation — typed, fail-closed on mismatch.
// ---------------------------------------------------------------------------

/** True when two primitives are equal (deep-ish fallback for containers). */
function eqValues(a: unknown, b: unknown): boolean {
  if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      /* fall through to reference compare */
    }
  }
  return Object.is(a, b);
}

/** Coerce a resolved operand to a comparable primitive (throws on non-primitive). */
function requireComparable(op: string, x: unknown): number | string {
  if (typeof x === "number" || typeof x === "string") return x;
  fail(`${op} requires comparable operands (number|string), got ${describe(x)}`);
}

/** Short human-readable type label used in failure messages. */
function describe(x: unknown): string {
  if (x === null) return "null";
  if (Array.isArray(x)) return "array";
  return typeof x;
}

/** Order check shared by $lt/$gt/$lte/$gte; both operands must share numeric/string category. */
function orderCheck(op: string, a: unknown, b: unknown): boolean {
  if ((typeof a === "number" || typeof a === "string") && (typeof b === "number" || typeof b === "string")) {
    const av = a as number | string;
    const bv = b as number | string;
    switch (op) {
      case "$lt":
        return av < bv;
      case "$gt":
        return av > bv;
      case "$lte":
        return av <= bv;
      case "$gte":
        return av >= bv;
      default:
        fail(`unsupported ordering operator '${op}'`);
    }
  }
  fail(`${op} cannot compare ${describe(a)} and ${describe(b)} (need number|number or string|string)`);
}

/** Evaluate a structured predicate node to a boolean, throwing on structural/type errors. */
export function evaluatePredicate(pred: unknown, vars: Record<string, unknown>): boolean {
  if (!isStructured(pred)) fail("when predicate must be a structured node like { $eq: [...] }");
  const record = pred as Record<string, unknown>;
  const op = Object.keys(record)[0]!;
  const operand = record[op];

  if (op === "$and" || op === "$or") {
    if (!Array.isArray(operand)) fail(`${op} requires an array of conditions`);
    if (op === "$and") return operand.every((c) => evaluatePredicate(c, vars));
    return operand.some((c) => evaluatePredicate(c, vars));
  }

  if (op === "$not") {
    const inner = Array.isArray(operand) ? operand[0] : operand;
    if (inner === undefined) fail("$not requires a condition");
    return !evaluatePredicate(inner, vars);
  }

  if (op === "$eq" || op === "$ne") {
    if (!Array.isArray(operand) || operand.length !== 2) fail(`${op} expects exactly two operands`);
    const left = resolveValue(operand[0], vars);
    const right = resolveValue(operand[1], vars);
    const result = eqValues(left, right);
    return op === "$eq" ? result : !result;
  }

  if (op === "$lt" || op === "$gt" || op === "$lte" || op === "$gte") {
    if (!Array.isArray(operand) || operand.length !== 2) fail(`${op} expects exactly two operands`);
    return orderCheck(op, resolveValue(operand[0], vars), resolveValue(operand[1], vars));
  }

  if (op === "$in") {
    // $in: [element, collection]  -> collection contains element.
    if (!Array.isArray(operand) || operand.length !== 2) fail("$in expects [element, collection]");
    const element = resolveValue(operand[0], vars);
    const collection = resolveValue(operand[1], vars);
    if (Array.isArray(collection)) return collection.some((c) => eqValues(c, element));
    if (typeof collection === "string") return String(element).includes(collection);
    fail(`$in collection must be an array or string, got ${describe(collection)}`);
  }

  fail(`unknown or unsupported predicate operator '${op}'`);
}

// ---------------------------------------------------------------------------
// Helper registry — `$call` invokes ONLY registered helpers (trusted project-local TS).
// ---------------------------------------------------------------------------

const globalRegistry = new Map<string, HelperFn>();

/** Register (or overwrite) a named helper callable; consumed by `$call`. */
export function registerHelper(name: string, fn: HelperFn): void {
  globalRegistry.set(name, fn);
}

/** Look up a registered helper by name, or `undefined` if absent. */
export function getRegisteredHelper(name: string): HelperFn | undefined {
  return globalRegistry.get(name);
}

/** Sorted list of globally-registered helper names (deterministic). */
export function listRegisteredHelpers(): string[] {
  return [...globalRegistry.keys()].sort();
}

/** Remove all globally-registered helpers (primarily for test isolation). */
export function clearRegisteredHelpers(): void {
  globalRegistry.clear();
}

/** Merge a map of helpers into the global registry (used when loading a helpers module file). */
export function registerHelpers(map: HelpersMap): void {
  for (const [name, fn] of Object.entries(map)) if (typeof fn === "function") registerHelper(name, fn);
}

/**
 * Effective lookup for `$call`: merges caller-supplied helpers with the global
 * registry so both imported-file helpers and pre-registered globals are callable.
 */
function lookupHelper(name: string, local: HelpersMap): HelperFn | undefined {
  if (local[name] !== undefined) return local[name];
  return globalRegistry.get(name);
}

/**
 * Load helpers from a project-local TypeScript/JavaScript module. The module's
 * NAMED EXPORTS become helpers keyed by export name. Trusted, project-local only
 * (no code execution beyond importing one declared file). Returns a flat map.
 *
 * NOTE: dynamic import of `.ts` is supported natively under Bun (the RoleCall runtime);
 * under plain Node provide an absolute path resolvable via ESM `import()`.
 */
export async function loadHelpers(modulePath: string): Promise<HelpersMap> {
  // Accept absolute paths directly; treat relative specifiers against cwd.
  const target = /^([A-Za-z]:)?\//.test(modulePath) ? modulePath : pathResolve(process.cwd(), modulePath);
  let mod: Record<string, unknown>;
  try {
    mod = await import(pathToFileURL(target).href);
  } catch (err) {
    throw new Error(`loadHelpers: could not import helpers module '${modulePath}': ${errMsg(err)}`);
  }
  const out: HelpersMap = {};
  for (const [name, value] of Object.entries(mod)) {
    if (typeof value === "function") out[name] = value as HelperFn;
  }
  return out;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
