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

  const normalTasks = playbook.tasks.filter((t) => !t.listen);
  const handlerTasks = playbook.tasks.filter((t) => t.listen);
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
    await runFree(normalTasks, baseHostsFor, state, result);
  } else {
    await runLinear(playbook, normalTasks, baseHostsFor, state, result);
  }

  // Fold this play's registered results into the shared result map.
  for (const h of allHosts) {
    Object.assign(result.registered[h]!, state.registered[h] ?? {});
  }

  result.handlers.push(...(await flushHandlers(runnableHandlers, allHosts, state)));

  // Tear down all opened transport connections.
  await Promise.all(
    allHosts.map(async (h) => {
      const conn = await state.connections.get(h);
      if (conn) await conn.disconnect();
    }),
  );

  for (const h of allHosts) {
    for (const o of result.hosts[h]!) {
      if (o.failed) result.failed++;
      else if (o.skipped) result.skipped++;
      else result.ok++;
      if (o.changed) result.changed++;
    }
  }
}

async function runLinear(
  playbook: NormalizedPlaybook,
  normalTasks: NormalizedTask[],
  baseHostsFor: (task: NormalizedTask) => string[],
  state: RunState,
  result: PlaybookResult,
): Promise<void> {
  const haltedHosts = new Set<string>();
  let playHalted = false;
  for (const task of normalTasks) {
    if (playHalted) break;
    const target = effectiveHosts(task, baseHostsFor(task)).filter((h) => !haltedHosts.has(h));
    if (target.length === 0) continue;
    const batches = playbook.serial ? chunk(target, playbook.serial) : [target];
    for (const batch of batches) {
      const outcomes = await Promise.all(
        batch.map((h) => runTaskOnHost(task, h, state)),
      );
      for (const o of outcomes) {
        (result.hosts[o.host] ??= []).push(o);
        if (o.halt === "play") playHalted = true;
        else if (o.halt === "host") haltedHosts.add(o.host);
      }
      if (playHalted) break;
    }
  }
}

async function runFree(
  normalTasks: NormalizedTask[],
  baseHostsFor: (task: NormalizedTask) => string[],
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
