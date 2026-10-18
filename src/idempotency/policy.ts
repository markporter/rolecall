// Idempotency policy: check-compare-write + cache + skip-unchanged (Todo 13).
//
// The decision is INTRINSIC to the module, never a per-task flag:
//  - side-effecting modules (sideEffecting===true OR no check path) ALWAYS apply.
//  - rolecall_managed_only default FALSE => fresh observe-and-reconcile every run;
//    the cache-skip fast-path is allowed ONLY when rolecall_managed_only=true AND hit.
//  - --force bypasses the cache entirely.

import type { Module, ModuleContext, ModuleResult } from "../executor/module";
import type { CheckableModule, IdempotencyOptions, IdempotentResult } from "./types";
import { computeCacheKey } from "./types";

function isSideEffecting(mod: Module): boolean {
  return (mod as { sideEffecting?: unknown }).sideEffecting === true;
}

function hasCheck(mod: Module): mod is CheckableModule {
  return typeof (mod as CheckableModule).check === "function";
}

/** Wrap a module's `run` with the idempotency policy. */
export async function applyIdempotent(
  module: Module,
  args: Record<string, unknown>,
  ctx: ModuleContext,
  opts: IdempotencyOptions = {},
): Promise<IdempotentResult> {
  const cache = opts.cache;
  const force = opts.force === true;
  const rolecallManagedOnly = opts.rolecallManagedOnly === true;

  // Force bypasses the cache entirely.
  if (force || !cache) {
    return runDirect(module, args, ctx);
  }

  // Inherently side-effecting modules always apply by nature.
  if (isSideEffecting(module) || !hasCheck(module)) {
    return runDirect(module, args, ctx);
  }

  const key = await computeCacheKey(ctx.host, module.name, args);

  // rolecall_managed_only fast-path: a cache hit means the desired block was applied
  // before, so skip the observe pass entirely.
  if (rolecallManagedOnly && (await cache.has(key))) {
    return {
      changed: false,
      skipped: true,
      cacheHit: true,
      msg: "skipped: cache hit (rolecall_managed_only)",
      data: { idempotent: true, reason: "cache hit (rolecall_managed_only)" },
    };
  }

  // Fresh observe-and-reconcile.
  const observed = await (module as CheckableModule).check!(args, ctx);
  if (observed.inDesired) {
    await cache.set(key, { observed: observed.current, appliedAt: Date.now() });
    return {
      changed: false,
      skipped: true,
      skippedUnchanged: true,
      msg: "skipped: already in desired state",
      data: { idempotent: true, reason: "already in desired state" },
    };
  }

  const res = await runDirect(module, args, ctx);
  await cache.set(key, { observed: observed.current, appliedAt: Date.now() });
  return res;
}

async function runDirect(
  module: Module,
  args: Record<string, unknown>,
  ctx: ModuleContext,
): Promise<IdempotentResult> {
  const res: ModuleResult = await module.run({ ...ctx, args });
  return res;
}
