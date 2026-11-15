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

/** Sentinel returned by the Jinja `omit` global; `renderArgs` drops args with this value. */
export const OMIT = "__rolecall_omit__";

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



function ipv6ToBigInt(ip: string): bigint | undefined {
  if (!ip.includes(":")) return undefined;
  const text = ip.split("%")[0]!;
  const [head = "", tail] = text.split("::");
  const headGroups = head.length > 0 ? head.split(":") : [];
  const tailGroups = tail !== undefined && tail.length > 0 ? tail.split(":") : [];
  const groups =
    tail === undefined
      ? headGroups
      : [...headGroups, ...Array(Math.max(0, 8 - headGroups.length - tailGroups.length)).fill("0"), ...tailGroups];
  if (groups.length !== 8) return undefined;
  let n = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return undefined;
    n = (n << 16n) | BigInt(Number.parseInt(group, 16));
  }
  return n;
}

function bigIntToIpv6(value: bigint): string {
  const groups = Array.from({ length: 8 }, (_, i) =>
    Number((value >> BigInt(112 - i * 16)) & 0xffffn).toString(16),
  );
  let bestStart = -1;
  let bestLength = 0;
  for (let i = 0; i < groups.length; ) {
    if (groups[i] !== "0") {
      i += 1;
      continue;
    }
    let j = i;
    while (j < groups.length && groups[j] === "0") j += 1;
    if (j - i > bestLength) {
      bestStart = i;
      bestLength = j - i;
    }
    i = j;
  }
  if (bestLength < 2) return groups.join(":");
  return `${groups.slice(0, bestStart).join(":")}::${groups.slice(bestStart + bestLength).join(":")}`;
}

function ipv4ToInt(ip: string): number | undefined {
  const parts = ip.split(".");
  if (parts.length !== 4) return undefined;
  let n = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return undefined;
    n = (n * 256) + octet;
  }
  return n >>> 0;
}

function intToIpv4(n: number): string {
  return [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join(".");
}

/** Minimal Ansible `ipaddr` for IPv4 CIDR queries; IPv6 passes through unchanged. */
function ipaddr(value: unknown, query?: unknown): unknown {
  const raw = String(value ?? "").trim();
  const [address = "", prefixRaw] = raw.split("/");
  const v6 = ipv6ToBigInt(address);
  if (v6 !== undefined) {
    const prefix = prefixRaw === undefined ? 128 : Number(prefixRaw);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) return null;
    const full = (1n << 128n) - 1n;
    const mask = prefix === 0 ? 0n : full ^ ((1n << BigInt(128 - prefix)) - 1n);
    const network = v6 & mask;
    const q = query === undefined || query === null ? "" : String(query);
    switch (q) {
      case "":
      case "address":
        return address;
      case "network":
        return bigIntToIpv6(network);
      case "prefix":
        return prefix;
      case "netmask":
        return bigIntToIpv6(mask);
      case "hostmask":
        return bigIntToIpv6(full ^ mask);
      case "network/prefix":
        return `${bigIntToIpv6(network)}/${prefix}`;
      case "address/prefix":
        return `${address}/${prefix}`;
      case "size": {
        const size = 2n ** BigInt(128 - prefix);
        return size <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(size) : size.toString();
      }
      default:
        return null;
    }
  }
  const n = ipv4ToInt(address);
  if (n === undefined) return query === undefined || query === "" ? raw : null;
  const prefix = prefixRaw === undefined ? 32 : Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
  const network = (n & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const q = query === undefined || query === null ? "" : String(query);
  switch (q) {
    case "":
    case "address":
      return address;
    case "network":
      return intToIpv4(network);
    case "prefix":
      return prefix;
    case "netmask":
      return intToIpv4(mask);
    case "hostmask":
      return intToIpv4((~mask) >>> 0);
    case "broadcast":
      return intToIpv4(broadcast);
    case "network/prefix":
      return `${intToIpv4(network)}/${prefix}`;
    case "address/prefix":
      return `${address}/${prefix}`;
    case "size":
      return 2 ** (32 - prefix);
    default:
      return null;
  }
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value > 1e12 ? value : value * 1000);
  if (typeof value === "string") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return undefined;
}

/** Small strftime subset used by Ansible templates (`%Y %m %d %H %M %S %s %z`). */
function strftime(value: unknown, format: unknown): string {
  const d = toDate(value);
  if (d === undefined) return String(value ?? "");
  const pad = (n: number, width = 2): string => String(n).padStart(width, "0");
  const tokens: Record<string, string> = {
    "%Y": String(d.getUTCFullYear()),
    "%m": pad(d.getUTCMonth() + 1),
    "%d": pad(d.getUTCDate()),
    "%H": pad(d.getUTCHours()),
    "%M": pad(d.getUTCMinutes()),
    "%S": pad(d.getUTCSeconds()),
    "%s": String(Math.floor(d.getTime() / 1000)),
    "%z": "+0000",
    "%%": "%",
  };
  return String(format ?? "%Y-%m-%d").replace(/%[YmdHMSsz%]/g, (token) => tokens[token] ?? token);
}

/** Human-readable byte/bit sizes using 1024-based units (Ansible-style). */
function humanReadable(value: unknown, isBits = false): string {
  let n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? "");
  if (isBits) n /= 8;
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let unit = 0;
  while (Math.abs(n) >= 1024 && unit < units.length - 1) {
    n /= 1024;
    unit += 1;
  }
  const rendered = unit === 0 ? String(Math.trunc(n)) : n.toFixed(2);
  return `${rendered} ${units[unit]}`;
}

/** Deterministic salted hash for `password_hash`; not a crypt(3) replacement. */
function passwordHash(value: unknown, algorithm = "sha512", salt?: unknown): string {
  const algo = String(algorithm).replace(/_crypt$/, "").replace(/-/g, "");
  const safe = ["sha256", "sha512", "sha1", "md5"].includes(algo) ? algo : "sha512";
  const saltText = salt === undefined ? "" : String(salt);
  return createHash(safe).update(`${saltText}${String(value ?? "")}`).digest("hex");
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
  zip: (value, ...others) => {
    const lists = [asArray(value), ...others.map(asArray)];
    const length = Math.min(...lists.map((list) => list.length));
    return Array.from({ length }, (_, i) => lists.map((list) => list[i]));
  },
  product: (value, ...others) => {
    let out: unknown[][] = asArray(value).map((item) => [item]);
    for (const other of others.map(asArray)) {
      const next: unknown[][] = [];
      for (const prefix of out) for (const item of other) next.push([...prefix, item]);
      out = next;
    }
    return out;
  },
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
  ipaddr: (value, query) => ipaddr(value, query),
  strftime: (value, format) => strftime(value, format),
  human_readable: (value, isBits) => humanReadable(value, isBits === true),
  password_hash: (value, algorithm, salt) => passwordHash(value, algorithm as string | undefined, salt),
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
  iterable: (value) =>
    typeof value === "string" || Array.isArray(value) || (typeof value === "object" && value !== null),
  mapping: (value) => typeof value === "object" && value !== null && !Array.isArray(value),
  succeeded: (value) => {
    const rec = asObject(value);
    return rec["failed"] !== true && rec["success"] !== false;
  },
  failed: (value) => asObject(value)["failed"] === true,
  changed: (value) => asObject(value)["changed"] === true,
  running: (value) => {
    const rec = asObject(value);
    return rec["running"] === true || rec["finished"] === false;
  },
};

/** Ansible globals that are safe pure functions. Lookups are deliberately absent. */
export const ANSIBLE_GLOBALS: Record<string, unknown> = {
  omit: OMIT,
  now: (fmt?: string) => {
    const d = new Date();
    return fmt === undefined ? d.toISOString() : d.toISOString();
  },
  lookup: () => {
    throw new Error("jinja lookup() is not supported; use a RoleCall module or a conversion gap item");
  },
  query: () => {
    throw new Error("jinja query() is not supported; use a RoleCall module or a conversion gap item");
  },
  q: () => {
    throw new Error("jinja q() is not supported; use a RoleCall module or a conversion gap item");
  },
};
