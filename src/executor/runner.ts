// Low-level task runner (Todo 12): executes a single task against one host,
// expands loops, evaluates `when`, applies `register`/`notify`, and flushes
// handlers. Orchestration (playbook/host batching) lives in engine.ts.

import type { Connection } from "../transport/connection";
import type { NormalizedTask } from "../config/schema";
import type { InventorySnapshot, ResolvedInventory } from "../inventory/engine";
import { basename } from "node:path";
import { type ModuleContext, type ModuleResult } from "./module";
import { resolveModule } from "../modules/resolver";
import { applyIdempotent, type CheckableModule, type IdempotencyOptions } from "../idempotency";
import { randomUUID } from "node:crypto";
import { createTwoFilesPatch } from "diff";
import { EgressPolicy } from "../isolation/egress";
import type { RunTrace } from "../store/types";
import {
  type ExecOptions,
  type HandlerOutcome,
  type IterationOutcome,
  type RolecallContext,
  type PlayMeta,
  type RunContext,
  type TaskEvent,
  type TaskOutcome,
  type TemplateVars,
  type TraceSink,
  createNoopConnection,
  evalWhen,
  expandLoop,
  renderArgs,
} from "./context";
import { findHandlers, HandlerCollector } from "./handlers";

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * Wraps a Connection so every module-initiated exec carries the ADR 0025
 * execution profile. Trusted modules that declare `network: true` get
 * `networked`; shell/command/script/raw and everything else stay `untrusted`.
 */
class ProfiledConnection implements Connection {
  constructor(
    private readonly inner: Connection,
    private readonly profile: "untrusted" | "networked",
  ) {}

  get kind(): Connection["kind"] {
    return this.inner.kind;
  }

  connect(): Promise<void> {
    return this.inner.connect();
  }

  exec(command: string, options?: ExecOptions): Promise<import("../transport/connection").ExecResult> {
    return this.inner.exec(command, { ...options, profile: this.profile });
  }

  facts(): Promise<import("../transport/connection").ConnectionFacts> {
    return this.inner.facts();
  }

  health(): Promise<import("../transport/connection").HealthStatus> {
    return this.inner.health();
  }

  disconnect(): Promise<void> {
    return this.inner.disconnect();
  }
}

const profiledCache = new WeakMap<Connection, Partial<Record<"untrusted" | "networked", ProfiledConnection>>>();

/** Reuse the profile wrapper so connection identity is stable per host/kind. */
function profileConnection(conn: Connection, profile: "untrusted" | "networked"): Connection {
  let entry = profiledCache.get(conn);
  if (!entry) {
    entry = {};
    profiledCache.set(conn, entry);
  }
  return (entry[profile] ??= new ProfiledConnection(conn, profile));
}

/**
 * Modules whose `run` only observes target state (or mutates executor-local run
 * state such as facts/registers) and is therefore safe to execute under `--check`.
 * Check-capable modules are detected automatically via a `check` method or the
 * explicit {@link import("./module").Module.supportsCheck} flag.
 */
const CHECK_MODE_READ_ONLY = new Set([
  "add_host",
  "assert",
  "debug",
  "fail",
  "find",
  "getent",
  "group_by",
  "group_info",
  "json_query",
  "meta",
  "pause",
  "service_facts",
  "set_fact",
  "set_reg",
  "set_stats",
  "slurp",
  "stat",
  "user_info",
]);

/** A structured observed-vs-desired diff attached when `--diff` is set. */
interface DiffSummary {
  before: unknown;
  after: unknown;
  /** Unified patch text when both snapshots serialize to text. */
  patch?: string;
}

function asDiffText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Build a unified diff between observed and desired state. */
function makeDiff(before: unknown, after: unknown): DiffSummary {
  const b = asDiffText(before);
  const a = asDiffText(after);
  if (b === a) return { before, after };
  return { before, after, patch: createTwoFilesPatch("current", "desired", b, a).trimEnd() };
}

/** Copy of rendered args without executor-internal control keys, for diff snapshots. */
function publicArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out = { ...args };
  delete out["_check"];
  delete out["check"];
  delete out["_diff"];
  delete out["_force"];
  return out;
}

/** True when a module can run safely under global check mode. */
function supportsCheck(mod: { name: string; supportsCheck?: boolean }): boolean {
  return typeof (mod as CheckableModule).check === "function" || mod.supportsCheck === true || CHECK_MODE_READ_ONLY.has(mod.name);
}

export interface RunState {
  resolved: ResolvedInventory;
  registered: Record<string, Record<string, unknown>>;
  failed: Set<string>;
  collector: HandlerCollector;
  options: ExecOptions;
  connections: Map<string, Promise<Connection>>;
  idempotency?: IdempotencyOptions;
  /** Monotonic counter used to order trace rows within a run (Todo 25). */
  traceSeq: number;
  /** Transaction id tagging every emitted trace (Todo 26); groups dependent plays. */
  txId?: string;
  /** Checkpoint id tagging every emitted trace (Todo 26); enables partial rollback/resume. */
  checkpointId?: string;
  /** Absolute directory of the playbook file; threaded into module context for path resolution. */
  playbookDir?: string;
  /** Static play/execution context shared across all hosts of a play (ADR 0013 §6). */
  playMeta: PlayMeta;
  /** Full inventory snapshot backing the `inv` namespace (ADR 0013 §7). */
  invSnapshot: InventorySnapshot;
  /** Run/invocation metadata (ADR 0013 §9). */
  runCtx: RunContext;
  /** Global platform constants (ADR 0013 §10). */
  rolecallCtx: RolecallContext;
  /** Resolved normal tasks excluded by the `--tags` / `--skip-tags` selection, mapped to their skip reason. */
  tagSkipped?: Map<NormalizedTask, string>;
  /** Set by a `meta: flush_handlers` task; the engine flushes and clears it at the next task boundary. */
  flushHandlersRequested?: boolean;
  /** Set by a `meta: end_batch` task; the engine stops the current serial batch and clears it. */
  endBatchRequested?: boolean;
  /** Set by a `meta: refresh_inventory` task; the engine re-reads the inventory source and clears it. */
  refreshInventoryRequested?: boolean;
}

function connectionKey(host: string, kind?: "ssh" | "local" | "network"): string {
  return `${host}\u0000${kind ?? ""}`;
}

async function getConnection(
  state: RunState,
  host: string,
  kind?: "ssh" | "local" | "network",
): Promise<Connection> {
  const key = connectionKey(host, kind);
  const cached = state.connections.get(key);
  if (cached) return cached;
  const factory =
    kind && state.options.connectionForKind
      ? (h: string) => state.options.connectionForKind!(h, kind)
      : state.options.connectionFor ?? createNoopConnection;
  const conn = await factory(host);
  await conn.connect();
  const p = Promise.resolve(conn);
  state.connections.set(key, p);
  return p;
}

async function disconnectPromises(pending: Promise<Connection>[]): Promise<void> {
  await Promise.all(
    pending.map(async (p) => {
      try {
        await (await p).disconnect();
      } catch {
      }
    }),
  );
}

/** @summary Disconnect every cached connection in a run and clear the cache. */
export async function disconnectAllConnections(state: RunState): Promise<void> {
  const pending = [...state.connections.values()];
  state.connections.clear();
  await disconnectPromises(pending);
}

async function resetHostConnections(state: RunState, host: string): Promise<void> {
  const prefix = `${host}\u0000`;
  const keys = [...state.connections.keys()].filter(
    (k) => k === host || k.startsWith(prefix),
  );
  const pending = keys.map((k) => state.connections.get(k)!);
  for (const k of keys) state.connections.delete(k);
  await disconnectPromises(pending);
}

function buildVars(
  state: RunState,
  host: string,
  item?: unknown,
  index?: number,
  task?: NormalizedTask,
): TemplateVars {
  const groups = state.invSnapshot.hosts[host]?.groups ?? [];
  const role = task?.roleDir
    ? { name: basename(task.roleDir), path: task.roleDir, ancestors: [] as string[] }
    : {};
  return {
    vars: state.resolved.hosts[host] ?? {},
    facts: state.options.facts?.[host] ?? {},
    reg: state.registered[host] ?? {},
    loop: { item, index },
    play: {
      host,
      name: state.playMeta.name,
      hosts: state.playMeta.hosts,
      groups,
      roles: state.playMeta.roles,
      path: state.playMeta.path,
    },
    inv: state.invSnapshot,
    role,
    run: state.runCtx,
    rolecall: state.rolecallCtx,
  };
}

export function effectiveHosts(task: NormalizedTask, allHosts: string[]): string[] {
  if (task.delegate_to) return [task.delegate_to];
  if (task.run_once) return allHosts.length > 0 ? [allHosts[0]!] : [];
  return allHosts;
}

export function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export async function runTaskOnHost(
  task: NormalizedTask,
  host: string,
  state: RunState,
  force = false,
): Promise<TaskOutcome> {
  const sink: TraceSink | undefined = state.options.trace;
  const runId = state.options.runId ?? "local";
  const emit = (
    phase: string,
    status: string,
    startedAt: number,
    endedAt: number | null,
    durationMs: number | null,
    detail: Record<string, unknown>,
    iteration = -1,
  ): void => {
    if (!sink) return;
    const trace: RunTrace = {
      id: randomUUID(),
      runId,
      host,
      taskName: task.name,
      iteration,
      phase,
      status,
      startedAt,
      endedAt,
      durationMs,
      detail: { module: task.module, ...detail },
      seq: state.traceSeq++,
      txId: state.txId,
      checkpointId: state.checkpointId,
    };
    sink(trace);
  };

  const taskStartedAt = Date.now();
  const taskT0 = performance.now();

  const fireEvent = (o: TaskOutcome): void => {
    const sink = state.options.eventSink;
    if (!sink) return;
    const status = o.failed ? "failed" : o.skipped ? "skipped" : o.changed ? "changed" : "ok";
    const event: TaskEvent = {
      ts: new Date().toISOString(),
      host: o.host,
      task: o.task,
      module: o.module,
      status,
      msg: o.msg,
    };
    sink(event);
  };

  const outcome: TaskOutcome = {
    task: task.name,
    host,
    module: task.module ?? "",
    changed: false,
    failed: false,
    skipped: false,
    iterations: [],
    notified: [],
  };
  // Tag selection is resolved against the task list BEFORE execution: an excluded
  // task is reported skipped on every host without opening a connection or running
  // its module. Handlers are never in this map (they follow the handler rule).
  const tagSkipReason = state.tagSkipped?.get(task);
  if (tagSkipReason !== undefined) {
    outcome.skipped = true;
    outcome.msg = tagSkipReason;
    emit("end", "skipped", taskStartedAt, Date.now(), Math.round(performance.now() - taskT0), { reason: "tag-filtered" });
    fireEvent(outcome);
    return outcome;
  }
  // Failure propagation: a host that already failed halts its downstream tasks.
  if (!force && state.failed.has(host)) {
    outcome.skipped = true;
    outcome.msg = "skipped: host failed earlier in play";
    emit("end", "skipped", taskStartedAt, Date.now(), Math.round(performance.now() - taskT0), { reason: "host-failed-earlier" });
    fireEvent(outcome);
    return outcome;
  }

  emit("start", "running", taskStartedAt, null, null, {});

  let conn: Connection;
  try {
    conn = await getConnection(state, host, task.connection);
  } catch (err) {
    outcome.failed = true;
    outcome.msg = `connection failed: ${err instanceof Error ? err.message : String(err)}`;
    state.failed.add(host);
    emit("end", "failed", taskStartedAt, Date.now(), Math.round(performance.now() - taskT0), { error: outcome.msg });
    fireEvent(outcome);
    return outcome;
  }
  const notify = Array.isArray(task.notify)
    ? task.notify
    : task.notify !== undefined
      ? [task.notify]
      : [];
  const loopItems = expandLoop(task.loop, buildVars(state, host, undefined, undefined, task));
  let anyChanged = false;
  let anyFailed = false;

  for (const { item, index } of loopItems) {
    const vars = buildVars(state, host, item, index, task);
    const iter: IterationOutcome = {
      index,
      item,
      changed: false,
      failed: false,
      skipped: false,
    };
    if (!evalWhen(task.when, vars)) {
      iter.skipped = true;
      emit("when-eval", "skipped", Date.now(), Date.now(), 0, { reason: "when-false" }, index);
      outcome.iterations.push(iter);
      continue;
    }
    const args = renderArgs(task.args, vars, {});
    const checkMode = state.options.check === true;
    const diffMode = state.options.diff === true;
    if (state.options.force === true) {
      args["force"] = true;
      args["_force"] = true;
    }
    if (checkMode) {
      args["_check"] = true;
      args["check"] = true;
    }
    if (diffMode) args["_diff"] = true;
    const resolved = resolveModule(task.module ?? "");
    const iterStart = performance.now();
    const iterStartedAt = Date.now();
    if (resolved.kind !== "module") {
      const msg =
        resolved.kind === "ambiguous"
          ? `ambiguous module reference '${resolved.spec}': ${resolved.candidates.join(", ")} — use the fully-qualified name`
          : `module not found: ${resolved.spec}`;
      iter.failed = true;
      iter.msg = msg;
      anyFailed = true;
      emit("module-run", "failed", iterStartedAt, Date.now(), Math.round(performance.now() - iterStart), { error: msg }, index);
    } else {
      const mod = resolved.module;
      const egress = state.options.isolation?.egress?.length
        ? new EgressPolicy(state.options.isolation.egress)
        : undefined;
      const moduleCtx: ModuleContext = {
        host,
        connection: profileConnection(conn, mod.network === true ? "networked" : "untrusted"),
        ...(egress ? { egress } : {}),
        args,
        vars: vars.vars,
        facts: vars.facts,
        reg: state.registered[host] ?? {},
        loop: { item, index },
        signal: state.options.signal,
        become: task.become ?? false,
        become_user: task.become_user,
        environment: task.environment,
        no_log: task.no_log,
        roleDir: task.roleDir,
        playbookDir: state.playbookDir,
        setFact: (k: string, v: unknown) => {
          const f = (state.options.facts ??= {});
          (f[host] ??= {})[k] = v;
        },
        setStat: (k: string, v: unknown) => {
          const s = (state.options.stats ??= {});
          s[k] = isPlainObject(s[k]) && isPlainObject(v) ? { ...(s[k] as Record<string, unknown>), ...v } : v;
        },
        clearFacts: () => {
          if (state.options.facts) state.options.facts[host] = {};
        },
        resetConnection: async () => {
          await resetHostConnections(state, host);
        },
        addHost: (name: string, groups: string[], vars: Record<string, unknown>) => {
          const d = (state.options.dynamicHosts ??= {});
          const existing = d[name];
          if (existing) {
            const mergedGroups = [...existing.groups];
            for (const group of groups) {
              if (!mergedGroups.includes(group)) mergedGroups.push(group);
            }
            d[name] = { groups: mergedGroups, vars: { ...existing.vars, ...vars } };
          } else {
            d[name] = { groups: [...groups], vars: { ...vars } };
          }
          const priorVars = state.resolved.hosts[name];
          state.resolved.hosts[name] = priorVars
            ? { ...priorVars, ...vars }
            : { ...vars };
          state.registered[name] ??= {};
        },
        setReg: (k: string, v: unknown) => {
          const r = (state.registered[host] ??= {});
          r[k] = v;
        },
      };
      try {
        const runModule = (): Promise<ModuleResult> =>
          state.idempotency?.cache
            ? applyIdempotent(mod, args, moduleCtx, {
                cache: state.idempotency.cache,
                force: force || state.idempotency.force === true || state.options.force === true,
                rolecallManagedOnly: state.idempotency.rolecallManagedOnly,
              })
            : mod.run(moduleCtx);
        const checkFn = (mod as CheckableModule).check;
        const canCheck = supportsCheck(mod);
        let observed: { current: unknown; inDesired: boolean } | undefined;
        if ((checkMode || diffMode) && typeof checkFn === "function") {
          try {
            observed = await checkFn.call(mod, args, moduleCtx);
          } catch (err) {
            if (checkMode) throw err;
          }
        }

        let res: ModuleResult;
        if (checkMode && !canCheck) {
          iter.skipped = true;
          outcome.skipped = true;
          res = {
            changed: false,
            skipped: true,
            msg: `skipped: check mode not supported by module '${mod.name}'`,
            data: { check: true, supported: false },
          };
        } else if (checkMode) {
          if (observed) {
            res = {
              changed: !observed.inDesired,
              msg: observed.inDesired
                ? "ok: already in desired state (check)"
                : "would change (check)",
              data: {
                check: true,
                inDesired: observed.inDesired,
                current: observed.current,
                ...(diffMode ? { diff: makeDiff(observed.current, publicArgs(args)) } : {}),
              },
            };
          } else {
            res = await runModule();
            const wouldChange =
              !res.failed &&
              (res.data?.["wouldChange"] === true || res.data?.["dryRun"] === true);
            if (wouldChange) res = { ...res, changed: true, skipped: false };
          }
        } else {
          res = await runModule();
          if (diffMode && observed && typeof checkFn === "function") {
            let after: { current: unknown; inDesired: boolean } | undefined;
            try {
              after = await checkFn.call(mod, args, moduleCtx);
            } catch {
              // Post-observe is best-effort; keep the pre-observed diff when it fails.
            }
            res = {
              ...res,
              data: { ...(res.data ?? {}), diff: makeDiff(observed.current, after ? after.current : publicArgs(args)) },
            };
          }
        }
        iter.changed = res.changed;
        iter.failed = Boolean(res.failed);
        iter.stdout = res.stdout;
        iter.stderr = res.stderr;
        iter.msg = res.msg;
        iter.data = res.data;
        if (res.halt) {
          iter.halt = res.halt;
          outcome.halt = res.halt;
        }
        const meta = res.data?.["meta"];
        if (isPlainObject(meta)) {
          if (meta["flush_handlers"] === true) state.flushHandlersRequested = true;
          if (meta["end_batch"] === true) state.endBatchRequested = true;
          if (meta["refresh_inventory"] === true) state.refreshInventoryRequested = true;
        }
        if (moduleCtx.no_log) {
          iter.stdout = undefined;
          iter.stderr = undefined;
          iter.msg = "[redacted by no_log]";
          iter.data = undefined;
        }
        if (res.changed) anyChanged = true;
        if (res.failed) anyFailed = true;
        emit(
          "module-run",
          res.failed ? "failed" : "ok",
          iterStartedAt,
          Date.now(),
          Math.round(performance.now() - iterStart),
          { changed: res.changed, msg: res.msg ?? null },
          index,
        );
      } catch (err) {
        iter.failed = true;
        iter.msg = err instanceof Error ? err.message : String(err);
        anyFailed = true;
        emit("module-run", "failed", iterStartedAt, Date.now(), Math.round(performance.now() - iterStart), { error: iter.msg }, index);
      }
    }
    outcome.iterations.push(iter);
  }

  outcome.changed = anyChanged;
  outcome.failed = anyFailed;
  if (anyFailed) {
    state.failed.add(host);
    outcome.msg = outcome.msg ?? "task failed";
  }
  if (task.register && !outcome.skipped) {
    const reg = (state.registered[host] ??= {});
    reg[task.register] = {
      changed: outcome.changed,
      failed: outcome.failed,
      stdout: outcome.iterations
        .map((i) => i.stdout)
        .filter((s): s is string => s !== undefined)
        .join(""),
      stderr: outcome.iterations
        .map((i) => i.stderr)
        .filter((s): s is string => s !== undefined)
        .join(""),
      msg: outcome.msg,
      results: outcome.iterations,
    };
    emit("register", outcome.failed ? "failed" : "ok", Date.now(), Date.now(), 0, { register: task.register });
  }
  // Ansible semantics: a `notify` fires only when the task actually reported
  // `changed` and did not fail (skipped tasks never notify). A no-op task leaves
  // its handlers dormant, so idempotent convergence does not restart services.
  if (notify.length > 0 && !outcome.skipped && outcome.changed && !outcome.failed) {
    state.collector.notify(notify);
    outcome.notified = [...notify];
    emit("notify", "ok", Date.now(), Date.now(), 0, { handlers: notify });
  }
  emit("end", outcome.skipped ? "skipped" : anyFailed ? "failed" : "ok", taskStartedAt, Date.now(), Math.round(performance.now() - taskT0), { changed: anyChanged, failed: anyFailed });
  fireEvent(outcome);
  return outcome;
}

export async function flushHandlers(
  handlerTasks: NormalizedTask[],
  allHosts: string[],
  state: RunState,
): Promise<HandlerOutcome[]> {
  const out: HandlerOutcome[] = [];
  const runNames = new Set<string>();
  const pending = state.collector.pending();
  state.collector.clear();
  for (const name of pending) {
    for (const htask of findHandlers(handlerTasks, name)) {
      if (runNames.has(htask.name)) continue; // dedupe by handler name
      runNames.add(htask.name);
      const host = allHosts[0] ?? "localhost";
      const o = await runTaskOnHost(htask, host, state, true);
      out.push({
        handler: htask.name,
        host: o.host,
        changed: o.changed,
        failed: o.failed,
        msg: o.msg,
      });
    }
  }
  return out;
}
