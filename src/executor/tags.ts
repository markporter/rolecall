// Task selection by tag (global `--tags` / `--skip-tags`), evaluated against the
// resolved task list (after role composition and `include_tasks` expansion).
//
// Inheritance rule (deliberate, documented divergence from Ansible): a task's
// effective tags are its OWN `tags:` when it declares them; otherwise it inherits
// the play's `tags`. A task's own tags REPLACE the play's tags — there is no union.
// Ansible unions play + task tags; RoleCall keeps the simpler replace rule so a
// task's own tagging is unambiguous.
//
// Handler rule: handlers are tasks carrying `listen`. They are exempt from the
// `--tags` INCLUSION filter (a notified handler still flushes under `--tags`) and
// are excluded by `--skip-tags` only when a handler EXPLICITLY declares its own
// `tags:` intersecting the skip list. Play-inherited tags never exclude a handler.

import type { NormalizedTask } from "../config/schema";

/** Inclusion/exclusion tag selection parsed from the global CLI flags. */
export interface TagSelection {
  /** Inclusion filter: when non-empty, only tasks carrying at least one of these tags run. */
  tags?: string[];
  /** Exclusion filter: tasks carrying any of these tags are dropped; wins over {@link tags}. */
  skipTags?: string[];
}

/**
 * @summary Resolve a task's effective tags under the replace rule: task tags win over play tags when present.
 * @param taskTags The task's own `tags`, or undefined when it declares none.
 * @param playTags The owning play's `tags`, or undefined when the play declares none.
 * @returns The task's effective tags (its own when defined, else the play's, else an empty list).
 */
export function effectiveTaskTags(
  taskTags: string[] | undefined,
  playTags: string[] | undefined,
): string[] {
  if (taskTags !== undefined) return taskTags;
  return playTags ?? [];
}

/**
 * @summary Decide whether a task with the given effective tags survives the `--tags` / `--skip-tags` selection.
 * @param effectiveTags Tags resolved for the task by {@link effectiveTaskTags}.
 * @param selection Inclusion (`--tags`) and exclusion (`--skip-tags`) lists; either may be empty/absent.
 * @returns True when the task should run. With no filters, always true. `--tags` requires an intersection;
 * `--skip-tags` drops on any intersection and wins over `--tags` on conflict.
 */
export function taskPassesTagFilter(
  effectiveTags: string[],
  selection: TagSelection,
): boolean {
  const include = selection.tags ?? [];
  const skip = selection.skipTags ?? [];
  if (include.length > 0 && !effectiveTags.some((t) => include.includes(t))) {
    return false;
  }
  if (skip.length > 0 && effectiveTags.some((t) => skip.includes(t))) {
    return false;
  }
  return true;
}

/**
 * @summary Decide whether a handler (a task carrying `listen`) is excluded by `--skip-tags`.
 *
 * Handlers are exempt from the `--tags` inclusion filter. They are excluded only when they
 * EXPLICITLY declare their own `tags:` and one of those tags is in `--skip-tags`; tags a handler
 * merely inherits from its play never exclude it.
 * @param handlerTags The handler's own `tags`, or undefined when it declares none.
 * @param skipTags The `--skip-tags` list, or undefined when not given.
 * @returns True when the handler must not flush even if notified.
 */
export function handlerExcludedBySkipTags(
  handlerTags: string[] | undefined,
  skipTags: string[] | undefined,
): boolean {
  if (!skipTags || skipTags.length === 0) return false;
  if (handlerTags === undefined || handlerTags.length === 0) return false;
  return handlerTags.some((t) => skipTags.includes(t));
}

/**
 * @summary Compute, for the resolved normal-task list, which tasks are excluded by tag selection.
 * @param tasks Resolved normal tasks (no `listen`) of a play, after role/include expansion.
 * @param playTags The owning play's `tags`.
 * @param selection Inclusion/exclusion lists from the global CLI flags.
 * @returns A map of excluded task → skip reason message; empty when no filter excludes anything.
 */
export function selectTagSkippedTasks(
  tasks: NormalizedTask[],
  playTags: string[] | undefined,
  selection: TagSelection,
): Map<NormalizedTask, string> {
  const skipped = new Map<NormalizedTask, string>();
  if ((selection.tags?.length ?? 0) === 0 && (selection.skipTags?.length ?? 0) === 0) {
    return skipped;
  }
  for (const task of tasks) {
    const effective = effectiveTaskTags(task.tags, playTags);
    if (!taskPassesTagFilter(effective, selection)) {
      skipped.set(task, "skipped: tag-filtered");
    }
  }
  return skipped;
}
