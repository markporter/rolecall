// Handler collection + trigger registration stub (Todo 12).
//
// Handlers are tasks flagged with `listen` (or matched by `name`); they are NOT
// executed during the main task loop. Tasks `notify` a name; after all tasks the
// engine flushes each notified handler exactly once, in first-notified order,
// TODO(ROLECALL-PLACEHOLDER): scheduler/webhook (deep event-sourced triggering) deferred; only stub shape
// deduped by handler name. Deep event-sourced triggering is DEFERRED — only the
// schedule/hook registration shape is stubbed here.

import type { NormalizedTask, TriggerSpec } from "../config/schema";

/** Order-preserving, deduplicated collector of notified handler names. */
export class HandlerCollector {
  private order: string[] = [];
  private seen = new Set<string>();

  notify(names: string[]): void {
    for (const n of names) {
      if (!this.seen.has(n)) {
        this.seen.add(n);
        this.order.push(n);
      }
    }
  }

  /** Notified names in first-seen order. */
  pending(): string[] {
    return [...this.order];
  }

  clear(): void {
    this.order = [];
    this.seen.clear();
  }
}

/** Find handler tasks that respond to a notified name (by `listen` or `name`). */
export function findHandlers(
  handlerTasks: NormalizedTask[],
  name: string,
): NormalizedTask[] {
  return handlerTasks.filter((t) => t.listen === name || t.name === name);
}

export interface TriggerRegistration {
  trigger: TriggerSpec;
  registeredAt: number;
}

const registeredTriggers: TriggerRegistration[] = [];

/**
 * TODO(ROLECALL-PLACEHOLDER): schedule/hook registration STUB — scheduler/webhook wiring deferred
 * STUB (Todo 12): record a schedule/hook registration intent. Deep event-sourced
 * TODO(ROLECALL-PLACEHOLDER): schedule/hook registration STUB — scheduler/webhook wiring deferred
 * triggering is deferred — this does not wire a real scheduler or webhook.
 */
export function registerTriggerStub(
  trigger: TriggerSpec,
): TriggerRegistration {
  const reg: TriggerRegistration = { trigger, registeredAt: Date.now() };
  registeredTriggers.push(reg);
  return reg;
}

/** Read-only view of all trigger registrations recorded this session. */
export function listRegisteredTriggers(): readonly TriggerRegistration[] {
  return registeredTriggers;
}
