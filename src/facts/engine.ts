// Facts engine — targeted, cached, graceful gathering + templating injection.
//
// `gatherFacts(connection, requestedKeys, opts)` runs ONLY the gatherers that can
// supply the requested keys (targeted — no full sweep), merges their results, and
// caches the map per host+keys. A gatherer failure is caught: by default the
// failed keys are omitted (graceful partial) so an unreachable host doesn't abort
// the whole run; set `throwOnError` to surface a typed `FactError` instead.
//
// `mergeFactsIntoVars` injects collected facts into the templating context consumed
// by `src/executor/context.ts` `renderArgs`/`evalWhen` — facts become top-level
// template variables (and remain under `facts`). context.ts is imported read-only.

import type { Connection } from "../transport/connection";
import type { TemplateVars } from "../executor/context";

import { createInMemoryFactCache, type FactCache } from "./cache";
import { BUILTIN_GATHERERS } from "./gatherers";
import {
  FactError,
  type FactGatherer,
  type FactKey,
  type FactMap,
  type FactPlugin,
  type GatherOptions,
} from "./types";
import type { VarManifestEntry } from "../config/var-manifest/types";

export interface FactsEngineOptions {
  cache?: FactCache;
  /** Extra gatherers merged with the built-ins. */
  gatherers?: readonly FactGatherer[];
  /** User plugins whose gatherers are merged with the built-ins. */
  plugins?: readonly FactPlugin[];
}

// --- Global fact-plugin registry -------------------------------------------------
// Plugins and modules register fact providers here. Registered gatherers feed every
// FactsEngine (including the shared `defaultFactsEngine`); `declares` entries feed the
// declared-fact set consumed by `lintTemplateRefs`, so `$var: facts.*` references to
// plugin/module-owned facts validate under `var_strict`. The two previously-disconnected
// fact registries (declarations vs producers) are unified: a declared fact is, by
// construction, one a registered gatherer can produce.

const registeredFactPlugins: FactPlugin[] = [];
const declaredFactEntries: VarManifestEntry[] = [];

/**
 * @summary Register a fact plugin: merges its gatherers into the engine and records its declared fact schemas.
 * @param plugin The plugin whose gatherers and `declares` should enter the global registries.
 */
export function registerFactPlugin(plugin: FactPlugin): void {
  registeredFactPlugins.push(plugin);
  defaultFactsEngine.registerPlugin(plugin);
  if (plugin.declares) declaredFactEntries.push(...plugin.declares);
}

/** Snapshot of every registered fact plugin. */
export function getRegisteredFactPlugins(): readonly FactPlugin[] {
  return registeredFactPlugins;
}

/** Every fact schema declared by registered plugins/modules. */
export function getDeclaredFactEntries(): readonly VarManifestEntry[] {
  return declaredFactEntries;
}

/** Names of all declared facts (registered plugins/modules), used by `var_strict` `facts.` validation. */
export function getDeclaredFactNames(): Set<string> {
  const names = new Set<string>();
  for (const e of declaredFactEntries) if (e.kind === "fact") names.add(e.name);
  return names;
}

/** Derive a stable host id for the cache key (explicit opts.host wins). */
function hostOf(connection: Connection, opts?: GatherOptions): string {
  if (opts?.host) return opts.host;
  const withOpts = connection as unknown as { options?: { host?: string } };
  return withOpts.options?.host ?? connection.kind;
}

export class FactsEngine {
  #cache: FactCache;
  #gatherers: FactGatherer[];

  constructor(opts: FactsEngineOptions = {}) {
    this.#cache = opts.cache ?? createInMemoryFactCache();
    this.#gatherers = [...BUILTIN_GATHERERS];
    for (const g of opts.gatherers ?? []) this.#gatherers.push(g);
    for (const p of opts.plugins ?? []) this.#gatherers.push(...p.gatherers);
  }

  /** Register a user FactPlugin at runtime. */
  registerPlugin(plugin: FactPlugin): void {
    this.#gatherers.push(...plugin.gatherers);
  }

  /** Resolve the gatherer set whose `provides` intersect the requested keys.
   * Every gatherer that can supply any requested key is included (a key may have
   * multiple providers, e.g. `service_status` for ssh vs http); the connection-kind
   * filter in `gatherFacts` then selects the right transport-specific one. */
  #resolveGatherers(requestedKeys: readonly FactKey[]): FactGatherer[] {
    if (requestedKeys.length === 0) return [...this.#gatherers]; // full set
    const requested = new Set(requestedKeys);
    return this.#gatherers.filter((g) => g.provides.some((k) => requested.has(k)));
  }

  /**
   * Gather only the requested fact keys for `connection`. Returns a flat map of the
   * gathered keys. On cache hit the SAME cached object reference is returned (no
   * re-gather). Gatherer failures are skipped by default (graceful partial).
   */
  async gatherFacts(
    connection: Connection,
    requestedKeys: FactKey[],
    opts: GatherOptions = {},
  ): Promise<FactMap> {
    const host = hostOf(connection, opts);
    const sortedKeys = [...requestedKeys].sort();

    if (!opts.force) {
      const cached = await this.#cache.get(host, sortedKeys);
      if (cached) return cached;
    }

    // Only run gatherers valid for this connection's transport (Ansible-aligned:
    // connection type selects the gathering mechanism). Gatherers without
    // `connectionKinds` apply to every kind.
    const gatherers = this.#resolveGatherers(requestedKeys).filter(
      (g) => !g.connectionKinds || g.connectionKinds.includes(connection.kind),
    );
    const result: FactMap = {};

    for (const g of gatherers) {
      try {
        const partial = await g.gather(connection, opts);
        Object.assign(result, partial);
      } catch (err) {
        if (opts.throwOnError) {
          throw new FactError(
            `fact gatherer '${g.name}' failed for ${host}`,
            host,
            g.name,
            err,
          );
        }
        // Graceful: omit the failed gatherer's keys and continue.
      }
    }

    await this.#cache.set(host, sortedKeys, result);
    return result;
  }
}

/** Shared default engine for convenience (callers may construct their own). */
export const defaultFactsEngine = new FactsEngine();
