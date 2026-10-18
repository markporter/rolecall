// Inventory plugin interface + registry (Wave 1, Todo 4).
//
// Plugins are pluggable *sources* of inventory data. Each plugin's `resolve()`
// returns a PluginContribution: the hosts it knows about, the group->host
// membership, and the variable layers (group vars, host vars, inventory
// defaults, and an optional parent->child group hierarchy). The engine
// (engine.ts) merges every contribution into a single graph and resolves
// target patterns against it.
//
// Two built-ins ship registered in the registry:
//   - "static"  : reads the in-memory NormalizedInventory (YAML-derived).
//   - "dynamic" : an example env-backed hook (createDynamicEnvPlugin). A
//                file-backed variant (createDynamicFilePlugin) is also shipped
//                for tests / real dynamic sources.
//
// No transport / SSH / network calls happen here — plugins are pure in-memory
// (or local-file / env) sources. Templating is intentionally out of scope.

import type { NormalizedInventory } from "../config/schema";

import { FsProjectSource } from "../vfs/fs-project-source.js";
import type { ProjectSource } from "../vfs/project-source.js";

// ---------------------------------------------------------------------------
// Contribution shape
// ---------------------------------------------------------------------------

export interface PluginContribution {
  /** Every host this plugin knows about. */
  hosts: string[];
  /** group name -> member hosts. */
  groupHosts?: Record<string, string[]>;
  /** group name -> group-level var map. */
  groupVars: Record<string, Record<string, unknown>>;
  /** host name -> host-level var map (highest precedence layer). */
  hostVars?: Record<string, Record<string, unknown>>;
  /** inventory-level default vars (lowest precedence layer). */
  defaults?: Record<string, unknown>;
  /** parent group name -> child group names (for `group:children` expansion). */
  children?: Record<string, string[]>;
}

export interface PluginContext {
  /** The static inventory currently being resolved (plugins may read/augment). */
  inventory: NormalizedInventory;
}

export interface InventoryPlugin {
  readonly name: string;
  resolve(ctx: PluginContext): PluginContribution | Promise<PluginContribution>;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const registry = new Map<string, InventoryPlugin>();

export function registerInventoryPlugin(name: string, plugin: InventoryPlugin): void {
  registry.set(name, plugin);
}

export function getInventoryPlugin(name: string): InventoryPlugin | undefined {
  return registry.get(name);
}

export function listInventoryPlugins(): string[] {
  return [...registry.keys()].sort();
}

/** Registered plugins excluding the built-in "static" (the engine builds the
 *  static layer directly from the passed inventory). */
export function getDynamicPlugins(): InventoryPlugin[] {
  const out: InventoryPlugin[] = [];
  for (const [name, plugin] of registry) {
    if (name !== "static") out.push(plugin);
  }
  return out;
}

/** Test helper: drop all registered plugins. */
export function clearInventoryPlugins(): void {
  registry.clear();
}

// ---------------------------------------------------------------------------
// Built-in: static plugin (reads the in-memory NormalizedInventory)
// ---------------------------------------------------------------------------

export function createStaticPlugin(inventory: NormalizedInventory): InventoryPlugin {
  return {
    name: "static",
    resolve(): PluginContribution {
      const groups = inventory.groups;
      const hosts = new Set<string>();
      const groupHosts: Record<string, string[]> = {};
      const groupVars: Record<string, Record<string, unknown>> = {};
      const children: Record<string, string[]> = {};
      for (const [gname, group] of Object.entries(groups)) {
        groupHosts[gname] = [...group.hosts];
        for (const h of group.hosts) hosts.add(h);
        groupVars[gname] = { ...group.vars };
        if (group.children !== undefined && group.children.length > 0) {
          children[gname] = [...group.children];
        }
      }
      return {
        hosts: [...hosts],
        groupHosts,
        groupVars,
        ...(Object.keys(children).length > 0 ? { children } : {}),
        ...(inventory.hostVars !== undefined ? { hostVars: inventory.hostVars } : {}),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Built-in: dynamic plugin — file-backed (reads a JSON contribution file)
// ---------------------------------------------------------------------------

export interface DynamicFileOptions {
  name?: string;
  /** Path to a JSON file shaped like PluginContribution. */
  source: string;
  /** Optional project VFS used to read `source`; defaults to {@link FsProjectSource(cwd)}. */
  sourceFs?: ProjectSource;
}

/**
 * Build a file-backed dynamic inventory plugin whose contribution is read from disk through
 * the VFS seam. Backward-compatible: with no `sourceFs` the default {@link FsProjectSource(cwd)}
 * reads exactly as before (`Bun.file`).
 * @param opts Options including the JSON contribution path and an optional VFS source.
 * @returns An inventory plugin resolving the JSON contribution on demand.
 */
export function createDynamicFilePlugin(opts: DynamicFileOptions): InventoryPlugin {
  const name = opts.name ?? "dynamic";
  const source: ProjectSource = opts.sourceFs ?? new FsProjectSource(process.cwd());
  return {
    name,
    async resolve(): Promise<PluginContribution> {
      const text = await source.readText(opts.source);
      const data = JSON.parse(text) as Partial<PluginContribution>;
      return {
        hosts: data.hosts ?? [],
        groupHosts: data.groupHosts,
        groupVars: data.groupVars ?? {},
        hostVars: data.hostVars,
        defaults: data.defaults,
        children: data.children,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Built-in: dynamic plugin — env-backed (reads a JSON contribution from env)
// ---------------------------------------------------------------------------

export interface DynamicEnvOptions {
  name?: string;
  /** Env var holding a JSON PluginContribution (or empty -> no contribution). */
  envVar: string;
}

export function createDynamicEnvPlugin(opts: DynamicEnvOptions): InventoryPlugin {
  const name = opts.name ?? "dynamic";
  return {
    name,
    resolve(): PluginContribution {
      const raw = process.env[opts.envVar];
      if (!raw) return { hosts: [], groupVars: {} };
      const data = JSON.parse(raw) as Partial<PluginContribution>;
      return {
        hosts: data.hosts ?? [],
        groupHosts: data.groupHosts,
        groupVars: data.groupVars ?? {},
        hostVars: data.hostVars,
        defaults: data.defaults,
        children: data.children,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Default registry: ship the static + dynamic (env) built-ins.
// ---------------------------------------------------------------------------

registerInventoryPlugin("static", createStaticPlugin({ groups: {} }));
registerInventoryPlugin(
  "dynamic",
  createDynamicEnvPlugin({ envVar: "ROLECALL_DYNAMIC_INVENTORY" }),
);
