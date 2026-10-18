// Deterministic cron-driven scheduler (Todo 20).
//
// Arms enabled schedule definitions stored in the durable repository and fires
// their jobs through the orchestrator Engine (`engine.enqueue`). Each fired run
// records a durable RunRecord via the same Engine path used by HTTP dispatch.
// Non-idempotent actions (actionType === 'nonIdempotent' or params.force ===
// true) apply on every trigger because the Engine treats those as inherently
// side-effecting; no idempotency flag exists here.
//
// The durable store is the single source of truth for each schedule's nextRunAt,
// so enable/disable/cancel and out-of-band reschedules are observed every tick.
// Construction arms currently-enabled schedules (persisting their computed
// nextRunAt). `start()` runs a reconciliation loop on `tickMs`; `stop()` clears
// everything and is safe to call twice. `runOnce()` drives one pass now for
// deterministic testing / dry invocation.

import type { Schedule, SchedulesRepo } from "../store/types";
import { nextOccurrence, parseExpr } from "./cron";
import type { JobBody, SchedulerApi } from "./types";

const DEFAULT_TICK_MS = 1000;
const VALID_TYPES = ["playbook", "adhoc", "nonIdempotent"] as const;
type ActionType = (typeof VALID_TYPES)[number];

/** Anything able to enqueue a job body and return its run id. */
export interface Enqueuer {
  enqueue(body: JobBody): string;
}

export interface CronSchedulerOptions {
  tickMs?: number;
  repo: SchedulesRepo;
  engine: Enqueuer;
}

export class CronScheduler implements SchedulerApi {
  readonly #repo: SchedulesRepo;
  readonly #engine: Enqueuer;
  readonly #tickMs: number;
  readonly #armedIds = new Set<string>();
  readonly #initialLoad: Promise<void>;
  #timer?: ReturnType<typeof setInterval>;
  #started = false;

  constructor(opts: CronSchedulerOptions) {
    this.#repo = opts.repo;
    this.#engine = opts.engine;
    this.#tickMs = opts.tickMs ?? DEFAULT_TICK_MS;
    this.#initialLoad = this.#loadAndArmInitial();
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    await this.#initialLoad;
    this.#timer = setInterval(() => {
      void this.#reconcile();
    }, this.#tickMs);
  }

  stop(): void {
    if (!this.#started) return;
    this.#started = false;
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
    this.#armedIds.clear();
  }

  async runOnce(): Promise<void> {
    await this.#initialLoad;
    await this.#reconcile();
  }

  async trigger(params: Record<string, unknown>): Promise<boolean> {
    let type: string;
    if (typeof (params as Record<string, unknown>).type === "string") {
      type = (params as Record<string, unknown>).type as string;
    } else if (typeof (params as Record<string, unknown>).actionType === "string") {
      type = (params as Record<string, unknown>).actionType as string;
    } else {
      type = "adhoc";
    }
    const body = this.#makeJob(type, params);
    try {
      this.#engine.enqueue(body);
      return true;
    } catch {
      return false;
    }
  }

  async #loadAndArmInitial(): Promise<void> {
    let list: Schedule[];
    try {
      list = await this.#repo.list();
    } catch {
      return;
    }
    for (const s of list) {
      if (!s.enabled) continue;
      if (!this.#isValid(s.cronSpec)) {
        console.error(`skipping '${s.name}' (${s.id}): invalid cron spec '${String(s.cronSpec)}'`);
        continue;
      }
      this.#armedIds.add(s.id);
      if (typeof s.nextRunAt === "number") continue;
      try {
        const next = nextOccurrence(new Date(), s.cronSpec).getTime();
        await this.#repo.update(s.id, { nextRunAt: next });
      } catch (err) {
        console.error(`computing next-run for '${s.name}' (${s.id}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  async #reconcile(): Promise<void> {
    let list: Schedule[];
    try {
      list = await this.#repo.list();
    } catch {
      return;
    }
    const liveById = new Map(list.map((s) => [s.id, s] as const));

    for (const id of [...this.#armedIds]) {
      const cur = liveById.get(id);
      if (!cur || !cur.enabled) this.#armedIds.delete(id);
    }

    const now = Date.now();
    for (const s of list) {
      if (!s.enabled) continue;
      const specOk = this.#isValid(s.cronSpec);
      if (!specOk || !this.#armedIds.has(s.id)) await this.#arm(s);
      if (specOk && typeof s.nextRunAt === "number" && s.nextRunAt <= now) await this.#fire(s);
    }
  }

  async #arm(s: Schedule): Promise<void> {
    if (!this.#isValid(s.cronSpec)) {
      console.error(`arming '${s.name}' (${s.id}) rejected: invalid cron spec '${String(s.cronSpec)}'`);
      this.#armedIds.delete(s.id);
      return;
    }
    this.#armedIds.add(s.id);
    if (typeof s.nextRunAt === "number") return;
    try {
      const next = nextOccurrence(new Date(), s.cronSpec).getTime();
      await this.#repo.update(s.id, { nextRunAt: next });
    } catch (err) {
      console.error(`arming '${s.name}' (${s.id}) failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  #isValid(spec: unknown): boolean {
    try {
      parseExpr(spec as string);
      return true;
    } catch {
      return false;
    }
  }

  async #fire(s: Schedule): Promise<void> {
    let body: JobBody;
    try {
      body = this.#makeJob(s.actionType, s.params);
    } catch {
      this.#armedIds.delete(s.id);
      return;
    }
    let runId: string;
    try {
      runId = this.#engine.enqueue(body);
    } catch (err) {
      console.error(`enqueue failed for '${s.name}' (${s.id}): ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    try {
      const next = nextOccurrence(new Date(Date.now()), s.cronSpec).getTime();
      await this.#repo.update(s.id, { lastRunAt: Date.now(), nextRunAt: next });
    } catch (err) {
      console.error(`reschedule failed for '${s.name}' (${s.id}) after run ${runId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  #makeJob(actionType: string, params: Record<string, unknown>): JobBody {
    const src = params && typeof params === "object" ? params : {};
    const body = { ...src } as Record<string, unknown>;
    const mappedAction: ActionType = (VALID_TYPES as readonly string[]).includes(actionType)
      ? (actionType as ActionType)
      : "adhoc";
    if (!(VALID_TYPES as readonly string[]).includes(String((body as { type?: unknown }).type))) {
      body.type = mappedAction;
    }
    if ((body as { module?: unknown }).module == null || (body as { module?: unknown }).module === "") {
      body.module = "ping";
    }
    return body as unknown as JobBody;
  }
}
