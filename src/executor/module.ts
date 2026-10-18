// Module contract + registry (Todo 12).
//
// A Module is the unit of work the executor dispatches. The minimal built-in
// test modules `debug` and `assert` (used to exercise the control-flow engine
// without any transport-side implementation) live in src/modules/builtins and
// are re-registered here so they are always available, even before
// `registerAllModules()` runs.

import type { Connection } from "../transport/connection";
import type { VarManifestEntry } from "../config/var-manifest/types";
import type { FactGatherer } from "../facts/types";

import { FsProjectSource } from "../vfs/fs-project-source.js";
import { registerFactPlugin } from "../facts/engine";
import type { ProjectSource } from "../vfs/project-source.js";
import { debugModule } from "../modules/builtins/debug";
import { assertModule } from "../modules/builtins/assert";

/**
 * Per-invocation context handed to a module's `run` (ADR 0013). `host` stays a
 * direct convenience; `registered` becomes `reg` and loop `item`/`index` move
 * under `loop` to mirror the 9-namespace TemplateVars shape.
 */
export interface ModuleContext {
  readonly host: string;
  readonly connection: Connection;
  readonly args: Record<string, unknown>;
  readonly vars: Record<string, unknown>;
  readonly facts: Record<string, unknown>;
  readonly reg: Record<string, unknown>;
  readonly loop?: { item?: unknown; index?: number };
  readonly signal?: AbortSignal;
  /** When true, escalate privileges (sudo) on the target for this invocation. */
  readonly become?: boolean;
  /** When set, run escalated commands as this user (sudo -u <user>). Implies become. */
  readonly become_user?: string;
  /** Environment variables to export for the module command (task-level). */
  readonly environment?: Record<string, string>;
  /** When true, suppress logging of task args / stdout / stderr for this task. */
  readonly no_log?: boolean;
  /** Absolute role directory this task was composed from (if any); enables role-relative path resolution. */
  readonly roleDir?: string;
  /** Absolute directory of the playbook file being executed; enables playbook-relative path resolution. */
  readonly playbookDir?: string;
  /** When set, persist a host fact live so downstream tasks see it via `$var: facts.*`. */
  readonly setFact?: (key: string, value: unknown) => void;
  /** When set, persist a runtime register value live so downstream tasks see it via `$var: reg.*`. */
  readonly setReg?: (key: string, value: unknown) => void;
  /** When set, aggregate a run-level stat (persisted for the duration of the run). */
  readonly setStat?: (key: string, value: unknown) => void;
  /** When set, clear all live facts for this host. */
  readonly clearFacts?: () => void;
  /** When set, drop the cached transport connection so the next task re-establishes it. */
  readonly resetConnection?: () => Promise<void>;
  /** When set, register a host into the run-level dynamic inventory (Ansible `add_host` alternate). */
  readonly addHost?: (name: string, groups: string[], vars: Record<string, unknown>) => void;
}

/** Result returned by a module invocation. */
export interface ModuleResult {
  changed: boolean;
  failed?: boolean;
  skipped?: boolean;
  stdout?: string;
  stderr?: string;
  msg?: string;
  data?: Record<string, unknown>;
  /** Request the executor halt this host (`"host"`) or the whole play (`"play"`). */
  halt?: "host" | "play";
}

/** A pluggable unit of work. Registered by name; resolved at dispatch time. */
export interface Module {
  readonly name: string;
  run(ctx: ModuleContext): Promise<ModuleResult>;
  /**
   * Typed fact schemas this module can produce. When present, the module is
   * auto-registered as a fact plugin (via {@link registerModule}) so its facts are
   * gathered by the engine and `$var: facts.*` references to them validate under `var_strict`.
   */
  readonly facts?: readonly VarManifestEntry[];
  /** Optional gatherer that produces this module's {@link facts} over a connection. */
  readonly factGatherer?: FactGatherer;
}

/**
 * A module that can reverse a previously-applied change (Todo 26). The tx/checkpoint
 * engine invokes `undo` when rolling back an applied delta that belongs to a failed
 * transaction. `desired` is the original desired-state value the module recorded at
 * apply time (from `ModuleResult.data` or the task's args); a module that cannot
 * reverse a change simply omits `undo` and is excluded from auto-rollback (its delta
 * is reported in `pendingRollbackReport` instead).
 */
export interface UndoableModule extends Module {
  undo(ctx: ModuleContext, desired: unknown): Promise<ModuleResult> | ModuleResult;
}

/** Type guard: is this module reversible (exposes a callable `undo`)? */
export function isUndoableModule(
  m: Module | UndoableModule | undefined,
): m is UndoableModule {
  return !!m && typeof (m as UndoableModule).undo === "function";
}

const registry = new Map<string, Module>();

/**
 * Register (or overwrite) a module under its name. If the module declares
 * {@link Module.facts} and/or {@link Module.factGatherer}, it is also registered as a
 * fact plugin so its facts are gathered by the engine and validate under `var_strict`.
 * @param mod The module to register.
 */
export function registerModule(mod: Module): void {
  registry.set(mod.name, mod);
  if (mod.facts?.length || mod.factGatherer) {
    registerFactPlugin({
      name: `module:${mod.name}`,
      gatherers: mod.factGatherer ? [mod.factGatherer] : [],
      declares: mod.facts ?? [],
    });
  }
}

/** Look up a registered module by name, or `undefined` if absent. */
export function getModule(name: string): Module | undefined {
  return registry.get(name);
}

/**
 * Options for {@link listModules}: an optional project VFS plus any user-authored module specifiers.
 */
export interface ListModulesOptions {
  /**
   * Used to resolve relative user-module specifiers (those passed in {@link ListModulesOptions.specifiers})
   * via {@link ProjectSource.resolveImportablePath}. Defaults to reading modules from the current working
   * directory, preserving the historical "resolve against cwd" behavior.
   */
  source?: ProjectSource;
  /**
   * User-authored module specifiers to include alongside the built-in registry (e.g.
   * `["./roles/web/mod.ts"]`). Relative entries (starting with `./` or `../`) are resolved to their
   * absolute import location under `source`; bare names pass through unchanged so dispatch-by-name keeps working.
   */
  specifiers?: readonly string[];
}

/** True if a module specifier points inside the source tree rather than naming a registered module. */
function looksRelative(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../");
}

/**
 * Sorted list of registered module names (deterministic ordering). With {@link ListModulesOptions.specifiers},
 * each relative user module specifier (e.g. `"./mod.ts"`) is resolved to its absolute import location under the
 * source root via {@link ProjectSource.resolveImportablePath}; bare names pass through unchanged. This is how the
 * VFS reaches user modules (`module: ./path`), not just playbooks/inventory. Backward-compatible: called with no
 * arguments it returns exactly `[...registry.keys()].sort()` — identical to before.
 * @param options Optional VFS + user-authored specifiers to resolve.
 * @returns Sorted registered names, extended with any resolved relative specifiers.
 */
export function listModules(options?: ListModulesOptions): string[] {
  const registered = [...registry.keys()].sort();
  const specs = options?.specifiers;
  if (!specs || specs.length === 0) return registered;
  const source: ProjectSource = options.source ?? new FsProjectSource(process.cwd());
  const resolved = specs.map((spec) =>
    looksRelative(spec) ? source.resolveImportablePath(spec) : spec,
  );
  return [...registered, ...resolved].sort();
}

/** `debug` — echoes its (rendered) args; never changes anything (defined in src/modules/builtins/debug). */
/** `assert` — fails (failed:true) when `that` is falsy; used to test failure paths (defined in src/modules/builtins/assert). */

registerModule(debugModule);
registerModule(assertModule);
