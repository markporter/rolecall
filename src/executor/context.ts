// Executor shared types, templating helpers, and the no-op connection fallback
// (Todo 12). Kept dependency-light so the engine stays testable without real
// transport. Real modules (Todo 15) receive a real Connection from the caller.

import type { Connection } from "../transport/connection";
import type { ResolveOptions, InventorySnapshot } from "../inventory/engine";
import type { NormalizedInventory, NormalizedPlaybook } from "../config/schema";
import type { RunTrace } from "../store/types";
import {
  type HelpersMap,
  evaluatePredicate,
  isStructured,
  resolveNode,
  resolveValue,
} from "../templating/refs";

export type { Module, ModuleContext, ModuleResult } from "./module";
export type { RunTrace } from "../store/types";

/** Sink that receives a trace row at each execution phase (Todo 25). */
export type TraceSink = (trace: RunTrace) => void;

/** Status of a single task execution, used by the realtime syslog event sink. */
export type TaskEventStatus = "ok" | "changed" | "failed" | "skipped";

/** Realtime per-task event emitted AS a task is executed (drives `-o syslog`). */
export interface TaskEvent {
  /** ISO-8601 timestamp captured when the task finished on the host. */
  ts: string;
  host: string;
  task: string;
  module: string;
  status: TaskEventStatus;
  msg?: string;
}

/** Sink that receives a {@link TaskEvent} for every executed task when wired. */
export type TaskEventSink = (event: TaskEvent) => void;

/** Platform / engine constants — global, process-constant, never host/play/loop/role/run-specific (ADR 0013 §10). */
export interface RolecallContext {
  version: string;
  runtime: string;
  ansible_compat: boolean;
}

/** Run/invocation metadata for this CLI invocation / playbook run (ADR 0013 §9). */
export interface RunContext {
  id: string;
  started_at: string;
  epoch: number;
  playbook_path?: string;
  inventory_path?: string;
  limit?: string;
  forks?: number;
}

/** Static play/execution context shared across all hosts of a play (ADR 0013 §6). */
export interface PlayMeta {
  name?: string;
  hosts: string[];
  roles: string[];
  path?: string;
}

/** Variables visible to templates during a single task/iteration render (ADR 0013).
 *
 * Nine reserved, fully-qualified namespaces — `host`/`item`/`index` are no longer
 * top-level; they live under `play`/`loop`. The resolver walks dotted paths
 * (`$var: "namespace.key"`), so every distinct data source gets its own key and
 * registered/loop vars can never shadow a reserved alias. */
export interface TemplateVars {
  vars: Record<string, unknown>;
  facts: Record<string, unknown>;
  reg: Record<string, unknown>;
  loop: { item?: unknown; index?: number };
  play: { host: string; name?: string; hosts: string[]; groups: string[]; roles: string[]; path?: string };
  inv: InventorySnapshot;
  role: Record<string, unknown>;
  run: RunContext;
  rolecall: RolecallContext;
  [key: string]: unknown;
}

/** @summary Resolve every arg value against `vars`: bare strings stay literal; structured ref/predicate nodes ($var/$concat/$call/$template/…) resolve at any depth (nested arrays/plain objects recursed). @param args Module argument bag; string values are passed through verbatim, structured nodes resolve. @param vars Render scope (host vars/facts/item/index). @param helpers Optional helper map feeding `$call`; merged with globally-registered helpers. @returns Resolved arg bag; scalar passthrough preserves original types (escapeless). */
export function renderArgs(
  args: Record<string, unknown>,
  vars: TemplateVars,
  helpers: HelpersMap = {},
): Record<string, unknown> {
  const scope = vars as unknown as Record<string, unknown>;
  const resolveArg = (value: unknown): unknown =>
    typeof value === "string"
      ? value
      : resolveValue(value, scope, helpers);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) out[k] = resolveArg(v);
  return out;
}

/** Coerce a resolved scalar through the legacy truthiness rules used by old-style `when`. */
function coerceScalar(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const s = value.trim();
    if (s === "true") return true;
    if (s === "false") return false;
    return s.length > 0;
  }
  return Boolean(value);
}

/**
 * Evaluate a `when` guard. Accepts BOTH legacy scalars AND structured predicate
 * nodes. Missing `when` => always true. Legacy path: a bare boolean/number is
 * coerced directly; a bare string is treated literally then coerced ("true"/"false"
 * literals map to booleans, else non-empty is truthy). Structured path: an operator node whose
 * key starts with `$` tries {@link evaluatePredicate} first — predicate operators
 * (`{$eq,$ne,...}`) evaluate typedly and FAIL CLOSED (throw on type mismatch), while
 * reference/composite control ops (`{$var,$concat,$call,$if,$each}`) fall back to
 * {@link resolveNode}, then coerce the resolved value like a scalar. Non-`$` objects
 * are left for the legacy scalar coercion (preserving prior behaviour).
 */
export function evalWhen(when: unknown, vars: TemplateVars): boolean {
  if (when === undefined) return true;
  const scope = vars as unknown as Record<string, unknown>;
  if (isStructured(when)) {
    const record = when as Record<string, unknown>;
    const op = Object.keys(record)[0];
    if (typeof op === "string" && op.startsWith("$")) {
      try {
        return evaluatePredicate(when, scope);
      } catch {
        // Reference/composite/opaque operator -> resolve to a value, then coerce.
        return coerceScalar(resolveNode(when, scope));
      }
    }
  }
  if (typeof when === "string") {
    return coerceScalar(when);
  }
  return coerceScalar(when);
}

/**
 * Core expansion of an already-resolved loop source into iteration descriptors.
 * Arrays iterate element-wise; a string is JSON-parsed when possible else treated
 * as a single scalar item; anything else yields a single pass. Shared by both the
 * legacy `loop` path and the structured `{ $each: ... }` path below.
 */
function expandValue(
  value: unknown,
  vars: TemplateVars,
): { item: unknown; index: number }[] {
  if (value === undefined || value === null) return [{ item: undefined, index: 0 }];
  if (typeof value === "string") {
    const rendered = String(value).trim();
    try {
      value = JSON.parse(rendered);
    } catch {
      value = rendered;
    }
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => ({ item, index }));
  }
  if (typeof value === "string" && value.length > 0) {
    return [{ item: value, index: 0 }];
  }
  return [{ item: value, index: 0 }];
}

/**
 * Expand a `loop` value into iteration descriptors. Missing `loop` => a single
 * pass with `item`/`index` undefined. Legacy values behave exactly as before
 * (arrays iterate; strings JSON-parse or become a scalar item). A structured loop
 * node `{ $each: <source> }` resolves `<source>` first — either a literal list or a
 * `{ $var: listName }` reference to one — then applies the same expansion, so loops
 * can be driven entirely by structured references.
 */
export function expandLoop(
  loop: unknown,
  vars: TemplateVars,
): { item: unknown; index: number }[] {
  if (loop === undefined || loop === null) return [{ item: undefined, index: 0 }];
  if (isStructured(loop)) {
    const record = loop as Record<string, unknown>;
    const op = Object.keys(record)[0];
    if (op === "$each") {
      // Resolve the target (literal array OR {$var:list}) then reuse core logic.
      return expandValue(resolveValue(record.$each, vars as unknown as Record<string, unknown>), vars);
    }
  }
  return expandValue(loop, vars);
}

/** Minimal connection that performs no I/O — fallback for transport-less modules. */
export function createNoopConnection(host: string): Connection {
  return {
    kind: "local",
    async connect() {},
    async exec() {
      return { exitCode: 0, stdout: "", stderr: "" };
    },
    async facts() {
      return { host, user: "nobody", transport: "local" };
    },
    async disconnect() {},
    async health() {
      return { ok: true };
    },
  };
}

/** Options controlling a playbook / ad-hoc run. */
export interface ExecOptions {
  /** Per-host facts map (Todo 14 will populate real facts; executor just consumes). */
  facts?: Record<string, Record<string, unknown>>;
  /** Resolve a Connection for a host. Defaults to `createNoopConnection`. */
  connectionFor?: (host: string) => Connection | Promise<Connection>;
  /** Abort signal propagated to module invocations. */
  signal?: AbortSignal;
  /** Forwarded to `resolveTargets` for inventory resolution. */
  resolveOptions?: ResolveOptions;
  /** Highest-precedence vars (Ansible `--extra-vars`): win over play and inventory vars. */
  extraVars?: Record<string, unknown>;
  /** Run-level stat store, aggregated by the `set_stats` module across plays/hosts. */
  stats?: Record<string, unknown>;
  /** Run-level dynamic inventory, populated by the `add_host` module during a run. */
  dynamicHosts?: Record<string, { groups: string[]; vars: Record<string, unknown> }>;
  /** Run identifier tagging every emitted trace row (Todo 25); defaults to "local" when unset. */
  runId?: string;
  /** Trace sink: receives a {@link RunTrace} at each phase when tracing is enabled; no-op if absent. */
  trace?: TraceSink;
  /** Realtime per-task event sink: receives a {@link TaskEvent} for every executed task; drives `-o syslog` streaming, no-op if absent. */
  eventSink?: TaskEventSink;
  /** Transaction id tagging every emitted trace row (Todo 26); groups dependent plays for rollback. */
  txId?: string;
  /** Checkpoint id tagging every emitted trace row (Todo 26); enables partial rollback/resume. */
  checkpointId?: string;
  /** `--resume <run_id>:<checkpoint>` spec (Todo 26); planner acknowledges, the tx engine consumes it. */
  resume?: { runId: string; checkpointId: string };
  /** Absolute directory of the playbook file; threaded to modules for playbook-relative path resolution. */
  playbookDir?: string;
  /** Absolute path of the playbook file (ADR 0013 §9 `run.playbook_path`). */
  playbookPath?: string;
  /** Path of the inventory source (ADR 0013 §9 `run.inventory_path`). */
  inventoryPath?: string;
  /** Target host/pattern limit (mirrors the `--limit` global flag; ADR 0013 §9 `run.limit`). */
  limit?: string;
  /** Concurrency fan-out (mirrors the `--forks` global flag; ADR 0013 §9 `run.forks`). */
  forks?: number;
  /** Inclusion tag filter (mirrors the global `--tags` flag): when non-empty, only tasks carrying any listed tag run. */
  tags?: string[];
  /** Exclusion tag filter (mirrors the global `--skip-tags` flag): tasks carrying any listed tag are dropped; wins over {@link tags}. */
  skipTags?: string[];
}

export interface IterationOutcome {
  index: number;
  item: unknown;
  changed: boolean;
  failed: boolean;
  skipped: boolean;
  stdout?: string;
  stderr?: string;
  msg?: string;
  data?: Record<string, unknown>;
  /** Set when a task requested the executor halt this host or the whole play (via `meta`). */
  halt?: "host" | "play";
}

export interface TaskOutcome {
  task: string;
  host: string;
  module: string;
  changed: boolean;
  failed: boolean;
  skipped: boolean;
  iterations: IterationOutcome[];
  notified: string[];
  /** Set when a task requested the executor halt this host or the whole play (via `meta`). */
  halt?: "host" | "play";
  msg?: string;
}

export interface HandlerOutcome {
  handler: string;
  host: string;
  changed: boolean;
  failed: boolean;
  msg?: string;
}

export interface PlaybookResult {
  hosts: Record<string, TaskOutcome[]>;
  handlers: HandlerOutcome[];
  registered: Record<string, Record<string, unknown>>;
  changed: number;
  failed: number;
  skipped: number;
  ok: number;
}

/** A single task plus optional target hosts, for ad-hoc (`runTask`) invocation. */
export interface AdHocTask {
  name: string;
  module: string;
  args: Record<string, unknown>;
  when?: unknown;
  loop?: unknown;
  notify?: string | string[];
  register?: string;
  delegate_to?: string;
  run_once?: boolean;
  listen?: string;
  hosts?: string | string[];
}

export type { NormalizedInventory, NormalizedPlaybook };
