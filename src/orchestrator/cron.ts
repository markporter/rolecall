// Pure Vixie-style cron-expression parser (Todo 20). Deterministic UTC math.
//
// Supports the standard five-field layout:
//   minute hour day-of-month month day-of-week
// each field accepting "*", lists ("a,b"), ranges ("a-b"), and steps ("*/n",
// "a-b/n", "a/n"). Day-of-month and day-of-week follow the Vixie OR rule when
// BOTH are restricted (a match on either fires); otherwise the restricted field
// alone governs. All computation happens on Date values interpreted as UTC so
// results are reproducible regardless of host timezone.

export interface ParsedCron {
  readonly minute: ReadonlySet<number>;
  readonly hour: ReadonlySet<number>;
  readonly dom: ReadonlySet<number>;
  readonly month: ReadonlySet<number>;
  readonly dow: ReadonlySet<number>;
  /** day-of-week normalized to 0..6 (Sunday both 0 and 7 -> 0). */
  readonly dowNormalized: ReadonlySet<number>;
  readonly rawMinute: string;
  readonly rawHour: string;
  readonly rawDom: string;
  readonly rawMonth: string;
  readonly rawDow: string;
  /** True when the raw field was anything other than a bare "*". */
  readonly domRestricted: boolean;
  readonly dowRestricted: boolean;
}

interface FieldRange {
  min: number;
  max: number;
}

const FIELDS: readonly (readonly [string, FieldRange])[] = [
  ["minute", { min: 0, max: 59 }],
  ["hour", { min: 0, max: 23 }],
  ["dom", { min: 1, max: 31 }],
  ["month", { min: 1, max: 12 }],
  ["dow", { min: 0, max: 7 }],
];

const NUMERIC = /^\d+$/;
const MAX_STEPS = 1_000_000;

function invalid(expr: unknown, reason: string): Error {
  return new Error(`invalid cron expression "${String(expr)}" — ${reason}`);
}

/** Parse one comma-separated field into a set of allowed integer values. */
function parseField(fieldSpec: string, range: FieldRange, label: string, fullExpr: string): Set<number> {
  const out = new Set<number>();
  const items = fieldSpec.split(",");
  for (const item of items) {
    if (item === "") throw invalid(fullExpr, `${label} field has an empty element`);
    let span = item;
    let step = 1;
    const slash = item.split("/");
    if (slash.length > 2) throw invalid(fullExpr, `${label} field '${item}' may have at most one step (/)`);
    if (slash.length === 2) {
      span = slash[0] ?? "";
      if (!NUMERIC.test(slash[1] ?? "")) throw invalid(fullExpr, `${label} field '${item}' has a non-numeric step`);
      step = Number(slash[1]);
      if (step <= 0) throw invalid(fullExpr, `${label} field '${item}' step must be positive`);
    }
    let lo: number;
    let hi: number;
    if (span === "*") {
      lo = range.min;
      hi = range.max;
    } else {
      const parts = span.split("-");
      if (parts.length === 1) {
        if (!NUMERIC.test(parts[0] ?? "")) throw invalid(fullExpr, `${label} field '${item}' is not a valid value or '*'`);
        lo = Number(parts[0]);
        // A single value followed by a step extends up to the field maximum.
        hi = step > 1 ? range.max : lo;
      } else if (parts.length === 2) {
        if (!NUMERIC.test(parts[0] ?? "") || !NUMERIC.test(parts[1] ?? "")) {
          throw invalid(fullExpr, `${label} field '${item}' is not a valid 'a-b' range`);
        }
        lo = Number(parts[0]);
        hi = Number(parts[1]);
      } else {
        throw invalid(fullExpr, `${label} field '${item}' is not a valid range`);
      }
    }
    if (lo < range.min || lo > range.max || hi < range.min || hi > range.max || lo > hi) {
      throw invalid(fullExpr, `${label} field '${item}' is out of range (${range.min}-${range.max})`);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

/** True when `expr` parses cleanly. Never throws. */
export function isValid(expr: unknown): boolean {
  try {
    parseExpr(expr);
    return true;
  } catch {
    return false;
  }
}

/** Parse `expr`, throwing `Error('invalid cron expression "<expr>" …')` on failure. */
export function parseExpr(expr: unknown): ParsedCron {
  if (typeof expr !== "string") throw invalid(expr, "expected a string");
  const trimmed = expr.trim();
  if (trimmed === "") throw invalid(expr, "empty expression");
  const parts = trimmed.split(/\s+/).filter((p) => p.length > 0);
  if (parts.length !== 5) throw invalid(expr, `expected 5 fields, got ${parts.length}`);

  const minute = parseField(parts[0]!, FIELDS[0]![1], FIELDS[0]![0], expr);
  const hour = parseField(parts[1]!, FIELDS[1]![1], FIELDS[1]![0], expr);
  const dom = parseField(parts[2]!, FIELDS[2]![1], FIELDS[2]![0], expr);
  const month = parseField(parts[3]!, FIELDS[3]![1], FIELDS[3]![0], expr);
  const dow = parseField(parts[4]!, FIELDS[4]![1], FIELDS[4]![0], expr);

  for (const [name, set] of [[minute, hour], [hour, dom], [dom, month], [month, dow]] as const) {
    if (set.size === 0) throw invalid(expr, `${name} field resolved to no values`);
  }
  const dowNormalized = new Set([...dow].map((v) => (v === 7 ? 0 : v)));

  return {
    minute,
    hour,
    dom,
    month,
    dow,
    dowNormalized,
    rawMinute: parts[0]!,
    rawHour: parts[1]!,
    rawDom: parts[2]!,
    rawMonth: parts[3]!,
    rawDow: parts[4]!,
    domRestricted: parts[2]! !== "*",
    dowRestricted: parts[4]! !== "*",
  };
}

function firstOfNextMonth(t: Date): Date {
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

function startOfNextDay(t: Date): Date {
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1, 0, 0, 0, 0));
}

function dayMatches(c: ParsedCron, t: Date): boolean {
  const dom = t.getUTCDate();
  const dow = t.getUTCDay();
  if (!c.domRestricted && !c.dowRestricted) return true;
  if (c.domRestricted && c.dowRestricted) return c.dom.has(dom) || c.dowNormalized.has(dow);
  return c.domRestricted ? c.dom.has(dom) : c.dowNormalized.has(dow);
}

/** Smallest instant strictly greater than `after` matching the schedule. */
export function nextOccurrence(after: Date, expr: string): Date {
  const c = parseExpr(expr);
  const months = [...c.month];
  const hours = [...c.hour];
  const minutes = [...c.minute];

  let t = new Date(after.getTime());
  t.setMilliseconds(0);
  t.setUTCSeconds(0);

  for (let guard = 0; guard < MAX_STEPS; guard++) {
    if (!months.includes(t.getUTCMonth() + 1)) {
      t = firstOfNextMonth(t);
      continue;
    }
    if (!dayMatches(c, t)) {
      t = startOfNextDay(t);
      continue;
    }
    // Match from the smallest unit upward, carrying into larger units only when
    // no value remains in the current one — this keeps a fire inside its own hour.
    const H = t.getUTCHours();
    if (!hours.includes(H)) {
      const nh = hours.find((x) => x > H);
      if (nh === undefined) {
        t = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1, 0, 0, 0, 0));
        continue;
      }
      t = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), nh, 0, 0, 0));
      continue;
    }
    const M = t.getUTCMinutes();
    if (!minutes.includes(M)) {
      const nm = minutes.find((x) => x > M);
      if (nm === undefined) {
        t = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), H + 1, 0, 0, 0));
        continue;
      }
      t = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), H, nm, 0, 0));
      continue;
    }
    if (t.getTime() <= after.getTime()) {
      t = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), H, M + 1, 0, 0));
      continue;
    }
    return t;
  }
  throw new Error(`invalid cron expression "${expr}" — no occurrence within the search horizon`);
}
