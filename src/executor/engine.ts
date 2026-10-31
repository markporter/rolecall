// Declarative task executor — playbook orchestration (Todo 12).
//
// Runs a normalized playbook against resolved inventory + facts through transport
// connections. Implements: `when` guards, `loop` expansion, `notify`/`handlers`
// (on-change, deduped, flushed once at end), `register` (results as facts),
// `run_once`, `delegate_to`, `serial` batching, `strategy: free` (un-gated
// parallel, isolated failures), and per-host failure propagation (a failed host
// halts its downstream tasks — NOT silent continue). Single-task execution via
// `runTask`. Low-level per-host execution lives in ./runner.

import type { NormalizedInventory, NormalizedPlaybook, NormalizedTask } from "../config/schema";
import { loadInventoryFile } from "../config/loader";
import type { InventorySnapshot, ResolvedInventory } from "../inventory/engine";
import { resolveInventorySnapshot, resolveTargets } from "../inventory/engine";
import { detectRuntime } from "../util/runtime";
import { ROLECALL_VERSION } from "../util/version";
import {
  type AdHocTask,
  type ExecOptions,
  type RolecallContext,
  type PlayMeta,
  type PlaybookResult,
  type RunContext,
} from "./context";
import { HandlerCollector } from "./handlers";
import { handlerExcludedBySkipTags, selectTagSkippedTasks } from "./tags";
import {
  type RunState,
  chunk,
  disconnectAllConnections,
  effectiveHosts,
  flushHandlers,
  runTaskOnHost,
} from "./runner";

/** Run a normalized playbook file (one or more plays), returning a structured per-host/per-task result. */
export async function runPlaybook(
  playbook: NormalizedPlaybook[],
  inventory: NormalizedInventory,
  options: ExecOptions = {},
): Promise<PlaybookResult> {
  const result: PlaybookResult = {
    hosts: {},
    handlers: [],
    registered: {},
    changed: 0,
    failed: 0,
    skipped: 0,
    ok: 0,
  };
  for (const play of playbook) {
    await runPlay(play, inventory, options, result);
  }
  return result;
}

// Layer a play's var tiers into the resolved host var scope using Ansible
// precedence (lowest → highest): role defaults < inventory (all < group < host)
// < play vars (role vars + play vars) < extra vars (CLI --extra-vars, highest).
function applyPlayVars(
  resolved: ResolvedInventory,
  play: NormalizedPlaybook,
  extraVars: Record<string, unknown> = {},
): void {
  const roleDefaults = play.roleDefaults ?? {};
  const playVars = play.vars ?? {};
  for (const host of Object.keys(resolved.hosts)) {
    resolved.hosts[host] = {
      ...roleDefaults,
      ...resolved.hosts[host],
      ...playVars,
      ...extraVars,
    };
  }
}

/** Run a single normalized play and fold its outcomes into the shared result. */
async function runPlay(
  playbook: NormalizedPlaybook,
  inventory: NormalizedInventory,
  options: ExecOptions,
  result: PlaybookResult,
): Promise<void> {
  const resolved = await resolveTargets(
    inventory,
    playbook.hosts,
    options.resolveOptions ?? {},
  );
  applyPlayVars(resolved, playbook, options.extraVars ?? {});
  const allHosts = resolved.matchedHosts;
  const invSnapshot: InventorySnapshot = await resolveInventorySnapshot(
    inventory,
    options.resolveOptions ?? {},
  );
  const playMeta: PlayMeta = {
    name: playbook.name,
    hosts: allHosts,
    roles: playbook.appliedRoleNames ?? [],
    path: options.playbookPath,
  };
  const runCtx: RunContext = {
    id: options.runId ?? "local",
    started_at: new Date().toISOString(),
    epoch: Date.now(),
    playbook_path: options.playbookPath,
    inventory_path: options.inventoryPath,
    limit: options.limit,
    forks: options.forks,
  };
  const rolecallCtx: RolecallContext = {
    version: ROLECALL_VERSION,
    runtime: detectRuntime().name,
    ansible_compat: false,
  };

  const seenTasks = new Set<NormalizedTask>();
  const orderedTasks = [
    ...(playbook.pre_tasks ?? []),
    ...playbook.tasks,
    ...(playbook.post_tasks ?? []),
  ].filter((task) => {
    if (seenTasks.has(task)) return false;
    seenTasks.add(task);
    return true;
  });
  const normalTasks = orderedTasks.filter((t) => !t.listen);
  const handlerTasks = orderedTasks.filter((t) => t.listen);
  // Tag selection is resolved against the fully-expanded task list (roles +
  // include_tasks already spliced) before any task executes. Handlers are exempt
  // from the --tags inclusion filter; --skip-tags excludes a handler only when it
  // explicitly declares its own tags (see ./tags).
  const tagSkipped = selectTagSkippedTasks(normalTasks, playbook.tags, {
    tags: options.tags,
    skipTags: options.skipTags,
  });
  const runnableHandlers = handlerTasks.filter(
    (h) => !handlerExcludedBySkipTags(h.tags, options.skipTags),
  );

  const state: RunState = {
    resolved,
    registered: {},
    failed: new Set(),
    collector: new HandlerCollector(),
    options,
    connections: new Map(),
    traceSeq: 0,
    txId: options.txId ?? playbook.tx,
    checkpointId: options.checkpointId ?? playbook.checkpoint,
    playbookDir: options.playbookDir,
    playMeta,
    invSnapshot,
    runCtx,
    rolecallCtx,
    tagSkipped,
  };
  for (const h of allHosts) {
    state.registered[h] = {};
    result.registered[h] = result.registered[h] ?? {};
  }

  for (const h of allHosts) result.hosts[h] = result.hosts[h] ?? [];

  // Per-task `hosts:` override (Todo 5): a task declaring its own hosts targets
  // only those hosts; otherwise it inherits the play's resolved hosts. Resolved
  // up front (resolveTargets is async) so the per-task resolver stays sync.
  const taskBaseHosts = new Map<NormalizedTask, string[]>();
  for (const task of normalTasks) {
    if (task.hosts && task.hosts.length > 0) {
      const r = await resolveTargets(
        inventory,
        task.hosts,
        options.resolveOptions ?? {},
      );
      applyPlayVars(r, playbook, options.extraVars ?? {});
      taskBaseHosts.set(task, r.matchedHosts);
    }
  }
  const universe = (): string[] => [...allHosts, ...Object.keys(state.options.dynamicHosts ?? {})];
  const baseHostsFor = (task: NormalizedTask): string[] =>
    taskBaseHosts.get(task) ?? universe();

  if ((playbook.strategy ?? "linear") === "free") {
    await runFree(
      playbook,
      normalTasks,
      baseHostsFor,
      runnableHandlers,
      allHosts,
      state,
      result,
    );
  } else {
    await runLinear(
      playbook,
      normalTasks,
      baseHostsFor,
      runnableHandlers,
      allHosts,
      state,
      result,
    );
  }

  // Fold this play's registered results into the shared result map.
  for (const h of allHosts) {
    Object.assign(result.registered[h]!, state.registered[h] ?? {});
  }

  result.handlers.push(...(await flushHandlers(runnableHandlers, allHosts, state)));

  // Tear down all opened transport connections.
  await disconnectAllConnections(state);

  for (const h of allHosts) {
    for (const o of result.hosts[h]!) {
      if (o.failed) result.failed++;
      else if (o.skipped) result.skipped++;
      else result.ok++;
      if (o.changed) result.changed++;
    }
  }
}

interface MetaConsumption {
  endBatch: boolean;
  note?: string;
}

/**
 * @summary Consume executor control flags requested by a `meta` task at the current
 * task boundary: flush pending handlers, re-read the inventory source, and report
 * whether the current serial batch should end. Flags are cleared before any await so
 * concurrent host loops cannot double-consume them.
 * @param state Shared run state carrying the pending flags and inventory snapshot.
 * @param playbook Play being executed (hosts re-resolved on inventory refresh).
 * @param runnableHandlers Handler tasks eligible for flushing.
 * @param allHosts Mutable play host list; refreshed hosts are appended so later tasks see them.
 * @param result Shared playbook result (handler outcomes + refreshed host registration).
 * @returns Whether to end the current serial batch plus an optional human note.
 */
async function consumeMetaRequests(
  state: RunState,
  playbook: NormalizedPlaybook,
  runnableHandlers: NormalizedTask[],
  allHosts: string[],
  result: PlaybookResult,
): Promise<MetaConsumption> {
  let note: string | undefined;
  if (state.flushHandlersRequested) {
    state.flushHandlersRequested = false;
    result.handlers.push(...(await flushHandlers(runnableHandlers, allHosts, state)));
  }
  if (state.refreshInventoryRequested) {
    state.refreshInventoryRequested = false;
    const path = state.options.inventoryPath;
    if (path === undefined || path === "") {
      note = "refresh_inventory: no inventory source available; no-op";
    } else {
      try {
        const refreshed = await loadInventoryFile(path);
        const resolved = await resolveTargets(
          refreshed,
          playbook.hosts,
          state.options.resolveOptions ?? {},
        );
        applyPlayVars(resolved, playbook, state.options.extraVars ?? {});
        for (const [name, spec] of Object.entries(state.options.dynamicHosts ?? {})) {
          if (!resolved.hosts[name]) resolved.hosts[name] = { ...spec.vars };
        }
        state.resolved = resolved;
        state.invSnapshot = await resolveInventorySnapshot(
          refreshed,
          state.options.resolveOptions ?? {},
        );
        for (const host of resolved.matchedHosts) {
          if (!allHosts.includes(host)) allHosts.push(host);
          result.hosts[host] ??= [];
          state.registered[host] ??= {};
          result.registered[host] ??= {};
        }
      } catch (err) {
        note = `refresh_inventory: could not reload '${path}' (${err instanceof Error ? err.message : String(err)}); no-op`;
      }
    }
  }
  const endBatch = state.endBatchRequested === true;
  state.endBatchRequested = false;
  return { endBatch, note };
}

async function runLinear(
  playbook: NormalizedPlaybook,
  normalTasks: NormalizedTask[],
  baseHostsFor: (task: NormalizedTask) => string[],
  runnableHandlers: NormalizedTask[],
  allHosts: string[],
  state: RunState,
  result: PlaybookResult,
): Promise<void> {
  const haltedHosts = new Set<string>();
  const endedBatches = new Set<number>();
  let playHalted = false;
  for (const task of normalTasks) {
    if (playHalted) break;
    const target = effectiveHosts(task, baseHostsFor(task)).filter((h) => !haltedHosts.has(h));
    if (target.length === 0) continue;
    const batches = playbook.serial ? chunk(target, playbook.serial) : [target];
    for (let index = 0; index < batches.length; index++) {
      if (endedBatches.has(index)) continue;
      const batch = batches[index]!;
      const outcomes = await Promise.all(
        batch.map((h) => runTaskOnHost(task, h, state)),
      );
      for (const o of outcomes) {
        (result.hosts[o.host] ??= []).push(o);
        if (o.halt === "play") playHalted = true;
        else if (o.halt === "host") haltedHosts.add(o.host);
      }
      const meta = await consumeMetaRequests(
        state,
        playbook,
        runnableHandlers,
        allHosts,
        result,
      );
      if (meta.note) {
        for (const o of outcomes) {
          if (o.module === "meta") o.msg = `${o.msg ?? ""} (${meta.note})`;
        }
      }
      if (meta.endBatch && playbook.serial !== undefined) endedBatches.add(index);
      if (playHalted) break;
    }
  }
}

async function runFree(
  playbook: NormalizedPlaybook,
  normalTasks: NormalizedTask[],
  baseHostsFor: (task: NormalizedTask) => string[],
  runnableHandlers: NormalizedTask[],
  allHosts: string[],
  state: RunState,
  result: PlaybookResult,
): Promise<void> {
  const perHost = normalTasks.filter((t) => !t.run_once && !t.delegate_to);
  const special = normalTasks.filter((t) => t.run_once || t.delegate_to);
  // Candidate hosts = the play's resolved hosts plus every host named by a
  // per-task `hosts:` override (Todo 5), so a task targeting a host outside the
  // play's set still runs. Per-task filtering then keeps each task on its own set.
  const candidateHosts = new Set<string>(Object.keys(state.resolved.hosts));
  for (const task of normalTasks) {
    for (const h of baseHostsFor(task)) candidateHosts.add(h);
  }
  const haltedHosts = new Set<string>();
  let playHalted = false;
  await Promise.all(
    [...candidateHosts].map(async (h) => {
      for (const task of perHost) {
        if (playHalted || haltedHosts.has(h)) return;
        if (!baseHostsFor(task).includes(h)) continue;
        const o = await runTaskOnHost(task, h, state);
        (result.hosts[h] ??= []).push(o);
        const meta = await consumeMetaRequests(
          state,
          playbook,
          runnableHandlers,
          allHosts,
          result,
        );
        if (meta.note && o.module === "meta") {
          o.msg = `${o.msg ?? ""} (${meta.note})`;
        }
        if (o.halt === "play") { playHalted = true; return; }
        if (o.halt === "host") { haltedHosts.add(h); return; }
      }
    }),
  );
  for (const task of special) {
    if (playHalted) break;
    for (const h of effectiveHosts(task, baseHostsFor(task))) {
      if (haltedHosts.has(h)) continue;
      const o = await runTaskOnHost(task, h, state);
      (result.hosts[o.host] ??= []).push(o);
      const meta = await consumeMetaRequests(
        state,
        playbook,
        runnableHandlers,
        allHosts,
        result,
      );
      if (meta.note && o.module === "meta") {
        o.msg = `${o.msg ?? ""} (${meta.note})`;
      }
      if (o.halt === "play") { playHalted = true; break; }
      if (o.halt === "host") haltedHosts.add(h);
    }
  }
}

/** Run a single ad-hoc task against the given inventory/hosts. */
export async function runTask(
  adHocTask: AdHocTask,
  inventory: NormalizedInventory,
  options: ExecOptions = {},
): Promise<PlaybookResult> {
  const hosts = adHocTask.hosts ?? "all";
  const playbook: NormalizedPlaybook = {
    hosts: typeof hosts === "string" ? [hosts] : hosts,
    tasks: [
      {
        name: adHocTask.name,
        module: adHocTask.module,
        args: adHocTask.args,
        ...(adHocTask.when !== undefined ? { when: adHocTask.when } : {}),
        ...(adHocTask.loop !== undefined ? { loop: adHocTask.loop } : {}),
        notify: Array.isArray(adHocTask.notify)
          ? adHocTask.notify
          : adHocTask.notify !== undefined
            ? [adHocTask.notify]
            : [],
        ...(adHocTask.register !== undefined ? { register: adHocTask.register } : {}),
        ...(adHocTask.delegate_to !== undefined
          ? { delegate_to: adHocTask.delegate_to }
          : {}),
        ...(adHocTask.run_once !== undefined ? { run_once: adHocTask.run_once } : {}),
        ...(adHocTask.listen !== undefined ? { listen: adHocTask.listen } : {}),
      },
    ],
    vars: {},
  };
  return runPlaybook([playbook], inventory, options);
}
