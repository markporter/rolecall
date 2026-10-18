// Low-level task runner (Todo 12): executes a single task against one host,
// expands loops, evaluates `when`, applies `register`/`notify`, and flushes
// handlers. Orchestration (playbook/host batching) lives in engine.ts.

import type { Connection } from "../transport/connection";
import type { NormalizedTask } from "../config/schema";
import type { InventorySnapshot, ResolvedInventory } from "../inventory/engine";
import { basename } from "node:path";
import { type ModuleContext } from "./module";
import { resolveModule } from "../modules/resolver";
import { applyIdempotent, type IdempotencyOptions } from "../idempotency";
import { randomUUID } from "node:crypto";
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
}

async function getConnection(state: RunState, host: string): Promise<Connection> {
  const cached = state.connections.get(host);
  if (cached) return cached;
  const factory = state.options.connectionFor ?? createNoopConnection;
  const conn = await factory(host);
  await conn.connect();
  const p = Promise.resolve(conn);
  state.connections.set(host, p);
  return p;
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
    conn = await getConnection(state, host);
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
      const moduleCtx: ModuleContext = {
        host,
        connection: conn,
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
          const c = state.connections.get(host);
          if (c) {
            try {
              await (await c).disconnect();
            } catch {
              /* connection already torn down */
            }
            state.connections.delete(host);
          }
        },
        addHost: (name: string, groups: string[], vars: Record<string, unknown>) => {
          const d = (state.options.dynamicHosts ??= {});
          d[name] = { groups, vars };
          if (!state.resolved.hosts[name]) state.resolved.hosts[name] = vars;
          state.registered[name] ??= {};
        },
        setReg: (k: string, v: unknown) => {
          const r = (state.registered[host] ??= {});
          r[k] = v;
        },
      };
      try {
        const res = state.idempotency?.cache
          ? await applyIdempotent(mod, args, moduleCtx, {
              cache: state.idempotency.cache,
              force: force || state.idempotency.force === true,
              rolecallManagedOnly: state.idempotency.rolecallManagedOnly,
            })
          : await mod.run(moduleCtx);
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
  for (const name of state.collector.pending()) {
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
