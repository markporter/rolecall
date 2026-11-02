// Ansible-compatible Jinja filters, tests, and globals for the Nunjucks engine.
//
// Nunjucks gives us Jinja-shaped control flow; Ansible's value comes from its
// filter/test library. These are the common pure-data filters (no filesystem,
// command, or network access); lookups that need I/O remain unsupported and
// fail loudly so the converter can hand them off.

import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { posix } from "node:path";
import { dump as yamlDump, load as yamlLoad } from "js-yaml";

type Filter = (value: unknown, ...args: unknown[]) => unknown;
type Test = (value: unknown, ...args: unknown[]) => boolean;

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

function toBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "yes", "on", "1"].includes(v)) return true;
    if (["false", "no", "off", "0", ""].includes(v)) return false;
  }
  return Boolean(value);
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mergeDeep(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (typeof v === "object" && v !== null && !Array.isArray(v) && typeof out[k] === "object" && out[k] !== null && !Array.isArray(out[k])) {
      out[k] = mergeDeep(out[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function flatten(value: unknown, levels = Infinity): unknown[] {
  if (!Array.isArray(value)) return [value];
  if (levels === 0) return value;
  const out: unknown[] = [];
  for (const item of value) {
    if (Array.isArray(item)) out.push(...flatten(item, levels === Infinity ? Infinity : levels - 1));
    else out.push(item);
  }
  return out;
}

function unique<T>(items: T[]): T[] {
  const seen = new Set<unknown>();
  return items.filter((item) => {
    const key = typeof item === "object" && item !== null ? JSON.stringify(item) : item;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseVersion(value: unknown): number[] {
  return String(value ?? "")
    .trim()
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .map((p) => Number.parseInt(p, 10))
    .map((n) => (Number.isFinite(n) ? n : 0));
}

function compareVersion(a: unknown, b: unknown): number {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  const len = Math.max(av.length, bv.length);
  for (let i = 0; i < len; i++) {
    const d = (av[i] ?? 0) - (bv[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

function pythonReplacement(value: string): string {
  // Ansible/Jinja uses \1 backrefs; JS uses $1.
  return value.replace(/\\(\d+)/g, (_m, n: string) => `$${n}`);
}

function typeDebug(value: unknown): string {
  if (value === null || value === undefined) return "NoneType";
  if (Array.isArray(value)) return "list";
  if (typeof value === "object") return "dict";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "float";
  if (typeof value === "string") return "str";
  return typeof value;
}

/** Common Ansible filters implemented as pure data transforms. */
export const ANSIBLE_FILTERS: Record<string, Filter> = {
  default: (value, fallback, useFalsey = false) =>
    value === undefined || (useFalsey === true && isEmpty(value)) ? fallback : value,
  bool: (value) => toBool(value),
  to_json: (value, indent) => JSON.stringify(value, null, typeof indent === "number" ? indent : undefined),
  to_nice_json: (value) => JSON.stringify(value, null, 2),
  from_json: (value) => {
    try { return JSON.parse(String(value)); } catch { return value; }
  },
  to_yaml: (value, options) => yamlDump(value, typeof options === "object" && options !== null ? (options as never) : undefined).trimEnd(),
  to_nice_yaml: (value) => yamlDump(value, { indent: 2, lineWidth: -1, noRefs: true }).trimEnd(),
  from_yaml: (value) => {
    try { return yamlLoad(String(value)); } catch { return value; }
  },
  combine: (value, ...args) => {
    const recursive = args.length > 0 && typeof args[args.length - 1] === "boolean" ? Boolean(args.pop()) : false;
    let out = asObject(value);
    for (const arg of args) {
      const other = asObject(arg);
      out = recursive ? mergeDeep(out, other) : { ...out, ...other };
    }
    return out;
  },
  dict2items: (value, keyName = "key", valueName = "value") =>
    Object.entries(asObject(value)).map(([key, val]) => ({ [String(keyName)]: key, [String(valueName)]: val })),
  items2dict: (value, keyName = "key", valueName = "value") => {
    const out: Record<string, unknown> = {};
    for (const item of asArray(value)) {
      const obj = asObject(item);
      const key = obj[String(keyName)];
      if (key !== undefined) out[String(key)] = obj[String(valueName)];
    }
    return out;
  },
  flatten: (value, levels) => flatten(value, typeof levels === "number" ? levels : Infinity),
  unique: (value) => unique(asArray(value)),
  union: (value, other) => unique([...asArray(value), ...asArray(other)]),
  intersect: (value, other) => unique(asArray(value).filter((v) => asArray(other).includes(v))),
  difference: (value, other) => asArray(value).filter((v) => !asArray(other).includes(v)),
  symmetric_difference: (value, other) => unique([...asArray(value).filter((v) => !asArray(other).includes(v)), ...asArray(other).filter((v) => !asArray(value).includes(v))]),
  regex_replace: (value, pattern, replacement, ignorecase = false, multiline = false) => {
    const flags = `${ignorecase ? "i" : ""}${multiline ? "m" : ""}g`;
    return String(value ?? "").replace(new RegExp(String(pattern), flags), pythonReplacement(String(replacement)));
  },
  regex_search: (value, pattern, ignorecase = false, multiline = false) => {
    const flags = `${ignorecase ? "i" : ""}${multiline ? "m" : ""}`;
    const m = String(value ?? "").match(new RegExp(String(pattern), flags));
    return m ? m[0] : null;
  },
  regex_findall: (value, pattern, ignorecase = false, multiline = false) => {
    const flags = `${ignorecase ? "i" : ""}${multiline ? "m" : ""}g`;
    return [...String(value ?? "").matchAll(new RegExp(String(pattern), flags))].map((m) => (m.length > 1 ? m[1] : m[0]));
  },
  regex_escape: (value) => String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  basename: (value) => posix.basename(String(value ?? "")),
  dirname: (value) => posix.dirname(String(value ?? "")),
  splitext: (value) => {
    const ext = posix.extname(String(value ?? ""));
    const base = String(value ?? "").slice(0, String(value ?? "").length - ext.length);
    return [base, ext];
  },
  path_join: (value, ...parts) => posix.join(String(value ?? ""), ...parts.map(String)),
  expanduser: (value) => String(value ?? "").replace(/^~(?=$|\/)/, homedir()),
  b64encode: (value) => Buffer.from(String(value ?? ""), "utf8").toString("base64"),
  b64decode: (value) => Buffer.from(String(value ?? ""), "base64").toString("utf8"),
  checksum: (value, algorithm = "sha1") => createHash(String(algorithm)).update(String(value ?? "")).digest("hex"),
  hash: (value, algorithm = "sha1") => createHash(String(algorithm)).update(String(value ?? "")).digest("hex"),
  quote: (value) => `'${String(value ?? "").replace(/'/g, `'\\''`)}'`,
  ternary: (value, trueValue, falseValue) => (toBool(value) ? trueValue : falseValue),
  type_debug: (value) => typeDebug(value),
  version_compare: (value, other, operator, strict = false) => {
    const cmp = compareVersion(value, other);
    if (cmp === 0 && strict === true && String(value ?? "") !== String(other ?? "")) return false;
    if (operator === undefined || operator === null || operator === "") return cmp;
    switch (String(operator)) {
      case "==": case "eq": return cmp === 0;
      case "!=": case "ne": return cmp !== 0;
      case "<": case "lt": return cmp < 0;
      case "<=": case "le": return cmp <= 0;
      case ">": case "gt": return cmp > 0;
      case ">=": case "ge": return cmp >= 0;
      default: return false;
    }
  },
  mandatory: (value, message = "Mandatory variable is undefined") => {
    if (value === undefined || value === null) throw new Error(String(message));
    return value;
  },
  comment: () => "",
};

/** Ansible/Jinja tests exposed to Nunjucks via `is <test>`. */
export const ANSIBLE_TESTS: Record<string, Test> = {
  defined: (value) => value !== undefined,
  undefined: (value) => value === undefined,
  none: (value) => value === null,
  null: (value) => value === null,
  truthy: (value) => toBool(value),
  falsy: (value) => !toBool(value),
  match: (value, pattern) => new RegExp(`^(?:${String(pattern)})`).test(String(value ?? "")),
  search: (value, pattern) => new RegExp(String(pattern)).test(String(value ?? "")),
  regex: (value, pattern) => new RegExp(String(pattern)).test(String(value ?? "")),
  contains: (value, needle) => {
    if (typeof value === "string") return value.includes(String(needle));
    return asArray(value).includes(needle);
  },
  subset: (value, other) => asArray(other).every((v) => asArray(value).includes(v)),
  superset: (value, other) => asArray(value).every((v) => asArray(other).includes(v)),
  version_compare: (value, other, operator) => Boolean(ANSIBLE_FILTERS["version_compare"]!(value, other, operator)),
};

/** Ansible globals that are safe pure functions. Lookups are deliberately absent. */
export const ANSIBLE_GLOBALS: Record<string, unknown> = {
  now: (fmt?: string) => {
    const d = new Date();
    return fmt === undefined ? d.toISOString() : d.toISOString();
  },
  lookup: () => {
    throw new Error("jinja lookup() is not supported; use a RoleCall module or a handoff item");
  },
  query: () => {
    throw new Error("jinja query() is not supported; use a RoleCall module or a handoff item");
  },
  q: () => {
    throw new Error("jinja q() is not supported; use a RoleCall module or a handoff item");
  },
};
