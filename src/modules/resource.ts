// Idempotency-by-default resource helper (Todo 27).
//
// `resource()` lifts a declarative (describe, converge) pair into a Module that
// ALSO satisfies CheckableModule: `describe` becomes `check` (observe current
// state, compare to desired) and `converge` becomes `run` (the mutating apply).
// Because the returned object carries a `check` method, `applyIdempotent` (the
// idempotency policy) automatically performs observe-and-reconcile: re-runs that
// already observe the desired state are skipped with `skippedUnchanged` and issue
// ZERO convergence calls. This is the batteries-included path for authoring new
// idempotent modules without re-implementing the check/run wiring by hand.

import type { Module, ModuleContext, ModuleResult } from "../executor/module";
import type { CheckableModule } from "../idempotency/types";

/** Observed-vs-desired probe returned by a resource `describe` function. */
export interface DescribeResult {
  /** Snapshot of the currently-observed state (any serializable value). */
  current: unknown;
  /** True when the observed state already equals the desired args. */
  inDesired: boolean;
}

/** Options for {@link resource}. */
export interface ResourceOptions {
  /** Optional module name; set before registering (defaults to a placeholder). */
  name?: string;
  /**
   * Observe the current state for the given args and report whether it already
   * matches the desired state. Must be pure read — never mutate.
   * @param args Rendered module argument bag.
   * @param ctx Per-invocation module context (connection, host, vars, …).
   * @returns The observed `current` snapshot plus `inDesired`.
   */
  describe: (
    args: Record<string, unknown>,
    ctx: ModuleContext,
  ) => DescribeResult | Promise<DescribeResult>;
  /**
   * Mutate toward the desired state. Called only when `describe` reported
   * `inDesired: false` (or when no cache/force bypasses the policy).
   * @param args Rendered module argument bag.
   * @param ctx Per-invocation module context (connection, host, vars, …).
   * @returns The standard {@link ModuleResult}.
   */
  converge: (
    args: Record<string, unknown>,
    ctx: ModuleContext,
  ) => ModuleResult | Promise<ModuleResult>;
}

/**
 * Build an idempotent-by-default Module from a declarative describe/converge pair.
 * The returned object satisfies BOTH `Module` (via `run`) and `CheckableModule`
 * (via `check`), so the idempotency policy detects and uses `check` automatically.
 * @param opts The describe/converge pair (plus optional name).
 * @returns A Module & CheckableModule ready to `registerModule`.
 */
export function resource(opts: ResourceOptions): Module & CheckableModule {
  const mod: Module & CheckableModule = {
    name: opts.name ?? "__resource__",
    async run(ctx: ModuleContext): Promise<ModuleResult> {
      // Self-contained idempotency: observe before mutating so the module stays
      // idempotent even when the external idempotency policy/cache is not wired in
      // (e.g. a plain `playbook run` with no cache). `force` in the args bypasses
      // the skip (matches the `applyIdempotent` force path). When the policy IS
      // active it calls `check` first and may skip before reaching `run`.
      const force = Boolean((ctx.args as Record<string, unknown>)["force"]);
      if (!force) {
        const observed = await opts.describe(ctx.args, ctx);
        if (observed.inDesired) {
          return {
            changed: false,
            msg: "skipped: already in desired state",
            // Status stays `ok` (no new status enum); idempotency is signalled
            // via `data` so consumers/UI can render the no-op distinctly without
            // overloading the `skipped` status (reserved for not-executed tasks).
            data: { idempotent: true, reason: "already in desired state" },
          };
        }
      }
      return opts.converge(ctx.args, ctx);
    },
    async check(
      args: Record<string, unknown>,
      ctx: ModuleContext,
    ): Promise<DescribeResult> {
      return opts.describe(args, ctx);
    },
  };
  return mod;
}
