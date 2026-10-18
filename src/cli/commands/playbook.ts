import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { loadInventoryFile, resolveDirectoryVars, loadPlaybookFile } from "../../config/loader";
import { resolveTargets, type ResolveOptions } from "../../inventory/engine";
import { runPlaybook } from "../../executor/engine";
import { FsProjectSource } from "../../vfs/fs-project-source";
import type { PlaybookResult } from "../../executor/context";
import { registerAllModules } from "../../modules/builtins";
import { scanAndRegister } from "../../modules/resolver";
import { render as renderEta } from "../../templating/fast";
import { renderJinja } from "../../templating/jinja";
import type { NormalizedInventory } from "../../config/schema";
import { buildConnectionForHost } from "../connections";
import { defaultFactsEngine } from "../../facts/engine";
import { openStore } from "../../store";
import type { Store } from "../../store/types";
import { computeProfile, formatProfile, makeTraceSink } from "./run";
import type { TaskEvent } from "../../executor/context";
import { CliError, type ApplyTotals, type CliResult, type GlobalFlags, type RenderedTemplate, type TaskApplyOutcome } from "../types";
import { parseExtraVars } from "../parse-extra-vars";
import { parseTagList } from "../parse-tags";

interface ContentSpec {
  template?: unknown;
  engine?: unknown;
}

export async function runPlaybookCommand(
  sub: string | undefined,
  rest: string[],
  flags: GlobalFlags,
): Promise<CliResult> {
  if (sub !== "run") {
    throw new CliError(true, `unknown playbook subcommand '${sub ?? ""}' (expected: run)`);
  }
  const file = rest[0];
  if (!file) {
    throw new CliError(true, "playbook run requires a <file> argument");
  }

  // Validate tag flags eagerly (before any file load / host resolution) so a
  // malformed --tags / --skip-tags value is a usage error (exit 2) regardless of
  // whether the run reaches execution.
  const tags = flags.tags !== undefined ? parseTagList(flags.tags, "--tags") : undefined;
  const skipTags =
    flags.skipTags !== undefined ? parseTagList(flags.skipTags, "--skip-tags") : undefined;

  const playbook = await loadPlaybookFile(file);

  // Register builtins unconditionally (was previously gated behind the inventory
  // guard) and eagerly scan the project for local plugins so the executor can
  // resolve them by FQCN / unambiguous bare alias. Project root is the playbook's
  // directory, falling back to its parent only when the playbook dir has no
  // `plugins/` but the parent does (covers `project/playbooks/site.yaml` with
  // `project/plugins/`).
  const playbookDir = dirname(file);
  registerAllModules();
  const parentDir = dirname(playbookDir);
  const hasProjectDirs = (d: string): boolean =>
    existsSync(join(d, "plugins")) || existsSync(join(d, "collections"));
  const projectRoot =
    !hasProjectDirs(playbookDir) && hasProjectDirs(parentDir) ? parentDir : playbookDir;
  await scanAndRegister(projectRoot);

  // --resume <run_id>:<checkpoint> (Todo 26): the planner records/acknowledges it;
  // the real skip-set is computed by the tx engine (computeResumeSkipSet) against the ledger.
  let resumeNote = "";
  if (flags.resume) {
    const idx = flags.resume.indexOf(":");
    const runId = flags.resume.slice(0, idx);
    const checkpointId = flags.resume.slice(idx + 1);
    if (idx < 0 || !runId || !checkpointId) {
      throw new CliError(true, "--resume expects <run_id>:<checkpoint>");
    }
    resumeNote = `\n[resume] acknowledged resume of run ${runId} from checkpoint ${checkpointId}`;
  }

  let inventory: NormalizedInventory | undefined;
  let resolvedHosts: string[] = [];
  let varsByHost: Record<string, Record<string, unknown>> = {};
  let factsByHost: Record<string, Record<string, unknown>> = {};
  let directoryVars: ResolveOptions = {};
  if (flags.inventory) {
    const source = new FsProjectSource(dirname(flags.inventory));
    inventory = await loadInventoryFile(flags.inventory, source);
    const dirVars = await resolveDirectoryVars(flags.inventory, source);
    directoryVars = { groupVars: dirVars.groupVarsByGroup, hostVars: dirVars.hostVarsByHost };
    const mergedVars: Record<string, Record<string, unknown>> = {};
    const hostSet = new Set<string>();
    for (const play of playbook) {
      const res = await resolveTargets(
        inventory,
        flags.limit ? [flags.limit] : play.hosts,
        directoryVars,
      );
      for (const h of res.matchedHosts) {
        hostSet.add(h);
        mergedVars[h] = res.hosts[h] ?? {};
      }
    }
    resolvedHosts = [...hostSet].sort();
    varsByHost = mergedVars;
    const fByHost: Record<string, Record<string, unknown>> = {};
    for (const host of resolvedHosts) {
      try {
        const conn = buildConnectionForHost(host, varsByHost[host] ?? {});
        await conn.connect();
        try {
          fByHost[host] = (await defaultFactsEngine.gatherFacts(conn, [], {})) as Record<string, unknown>;
        } finally {
          await conn.disconnect();
        }
      } catch {
        // graceful: facts stay empty for unreachable hosts
      }
    }
    factsByHost = fByHost;
  }

  const skeleton = resolvedHosts.flatMap((h) =>
    playbook.flatMap((p) =>
      p.tasks.map((t) => ({ host: h, task: t.name, module: t.module ?? "" })),
    ),
  );

  const contentByTask = new Map<string, ContentSpec>();
  for (const p of playbook) {
    for (const t of p.tasks) {
      const c = t.args?.["content"] as ContentSpec | undefined;
      if (c && typeof c === "object" && typeof c.template === "string") contentByTask.set(t.name, c);
    }
  }

  let result: PlaybookResult | null = null;
  let traceStore: Store | undefined;
  let traceRunId: string | undefined;
  const wantTrace = flags.trace || flags.profile;
  // Realtime per-task event sink: for `-o syslog` stream one JSON line per task
  // AS it runs; other modes (human_summary/json) stay end-of-run summaries, so
  // the sink is left undefined and their events live only in the final CliResult.
  const eventSink: ((event: TaskEvent) => void) | undefined =
    flags.output === "syslog"
      ? (event) =>
          process.stdout.write(
            `${JSON.stringify({
              ts: event.ts,
              host: event.host,
              task: event.task,
              module: event.module,
              status: event.status,
              msg: event.msg,
            })}\n`,
          )
      : undefined;
  if (inventory && resolvedHosts.length > 0) {
    if (wantTrace) {
      traceStore = openStore();
      const run = await traceStore.runs.create({
        actionType: "cli-playbook-run",
        targetIds: resolvedHosts,
        status: "started",
        payload: { playbook: file },
      });
      traceRunId = run.id;
    }
    result = await runPlaybook(playbook, inventory, {
      connectionFor: (h) => buildConnectionForHost(h, varsByHost[h] ?? {}),
      playbookDir: dirname(file),
      playbookPath: file,
      inventoryPath: flags.inventory,
      ...(flags.limit !== undefined ? { limit: flags.limit } : {}),
      ...(flags.forks !== undefined ? { forks: flags.forks } : {}),
      ...(tags !== undefined ? { tags } : {}),
      ...(skipTags !== undefined ? { skipTags } : {}),
      ...(Object.keys(directoryVars).length > 0 ? { resolveOptions: directoryVars } : {}),
      extraVars: parseExtraVars(flags.extraVars),
      facts: factsByHost,
      ...(eventSink ? { eventSink } : {}),
      ...(traceStore && traceRunId
        ? { runId: traceRunId, trace: makeTraceSink(traceStore, traceRunId) }
        : {}),
    });
    if (traceStore && traceRunId) {
      await traceStore.runs
        .update(traceRunId, {
          status: result.failed > 0 ? "failed" : "success",
          finishedAt: Date.now(),
        })
        .catch(() => undefined);
    }
  }

  const totals: ApplyTotals = result
    ? { ok: result.ok, changed: result.changed, failed: result.failed, skipped: result.skipped }
    : { ok: 0, changed: 0, failed: 0, skipped: 0 };
  const outcomes: TaskApplyOutcome[] = [];
  const rendered: RenderedTemplate[] = [];
  if (result) {
    for (const h of Object.keys(result.hosts)) {
      for (const o of result.hosts[h]!) {
        outcomes.push({
          host: o.host,
          task: o.task,
          module: o.module,
          changed: o.changed,
          failed: o.failed,
          skipped: o.skipped,
          iterations: o.iterations.length,
          iterationData: o.iterations.map((i) => i.data),
          msg: o.msg,
        });
        const content = contentByTask.get(o.task);
        if (content) {
          const tpl = String(content.template);
          const engine = String(content.engine ?? "eta") === "jinja" ? "jinja" : "eta";
          const out = engine === "jinja" ? renderJinja(tpl, varsByHost[h] ?? {}) : renderEta(tpl, varsByHost[h] ?? {});
          rendered.push({ task: o.task, host: o.host, engine, source: tpl, rendered: out });
        }
      }
    }
  }

  const applied = result !== null;
  let note = applied
    ? "real apply via declarative executor + copy (remote SHA-256 compare); identical second run reports changed=false with zero write commands (idempotency)"
    : "no inventory / no matched hosts — nothing executed; pass --inventory to target remote hosts";
  if (traceStore && traceRunId && flags.trace) {
    note += `\n[trace] ledger persisted for run ${traceRunId} (replay: rolecall run replay ${traceRunId})`;
  }
  if (traceStore && traceRunId && flags.profile) {
    const traces = await traceStore.traces.listByRun(traceRunId);
    const profile = computeProfile(traces);
    note += `\n[profile] run ${traceRunId}\n${formatProfile(profile)}`;
  }
  if (traceStore) traceStore.close();
  if (resumeNote) note += resumeNote;

  return {
    command: "playbook run",
    playbook: file,
    inventory: flags.inventory,
    mode: applied ? "applied" : "dry-run",
    flags: { limit: flags.limit, force: flags.force, check: flags.check, diff: flags.diff, forks: flags.forks, ...(tags !== undefined ? { tags } : {}), ...(skipTags !== undefined ? { skipTags } : {}) },
    resolvedHosts,
    tasks: playbook.flatMap((p) =>
      p.tasks.map((t) => ({ name: t.name, module: t.module ?? "" })),
    ),
    skeleton,
    ...(applied ? { totals, outcomes, rendered } : {}),
    check: flags.check,
    force: flags.force,
    note,
  };
}

