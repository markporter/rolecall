// Inventory resolution engine (Wave 1, Todo 4).
//
// Builds a host+group graph from the normalized inventory model (Todo 3
// `NormalizedInventory`) plus any registered/extra InventoryPlugins, then
// resolves a set of target patterns into a DETERMINISTIC per-host var map.
//
// ===========================================================================
// VARIABLE PRECEDENCE (lowest precedence -> highest precedence)
// ===========================================================================
//   1. inventory defaults   (options.defaults / plugin `defaults`)
//   2. group_all vars        (the group named by `allGroupName`, default "all")
//                            applied to EVERY host regardless of membership
//   3. group vars            (each group the host belongs to plus that group's
//                            transitive ancestors, merged ROOT-FIRST so a child
//                            group overrides its parents — Ansible semantics.
//                            Groups with no parent/child relationship among them
//                            keep the legacy deterministic sorted-name order.)
//   4. host vars             (options.hostVars / plugin `hostVars`) — highest
//
// i.e.  host > descendant group > ancestor group > group_all > defaults
//
// ===========================================================================
// TARGET PATTERNS (each entry in `targets`)
// ===========================================================================
//   "host1"          literal host name
//   "web*"           glob over host names AND group names ('*' matches any run)
//   "web"            a group name -> its member hosts
//   "web:children"   a group + all descendant groups (recursive via `children`)
//   "all"            every known host
//
// ===========================================================================
// DETERMINISM
// ===========================================================================
// Host names and var keys are SORTED before the resolved map / snapshot is
// produced, so output is stable across runtimes (explicit acceptance criterion).
//
// No transport / SSH / network calls. No templating (vars are raw values).

import type { NormalizedInventory } from "../config/schema";
import {
  type InventoryPlugin,
  type PluginContribution,
  createStaticPlugin,
  getDynamicPlugins,
} from "./plugin";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ResolveOptions {
  /** Host-level var overrides (highest precedence layer). */
  hostVars?: Record<string, Record<string, unknown>>;
  /** Directory-adjacent `group_vars/<group>.yaml` contribution (group precedence layer). */
  groupVars?: Record<string, Record<string, unknown>>;
  /** Inventory-level default vars (lowest precedence layer). */
  defaults?: Record<string, unknown>;
  /** Parent group name -> child group names. */
  children?: Record<string, string[]>;
  /** Name of the implicit "all" group (default "all"). */
  allGroupName?: string;
  /** Extra dynamic plugins to merge. When provided, REPLACES the registered
   *  dynamic plugins (so resolution stays deterministic in tests). */
  plugins?: InventoryPlugin[];
}

export interface ResolvedInventory {
  /** Sorted list of hosts matched by the target patterns. */
  matchedHosts: string[];
  /** Sorted host -> resolved var map (var keys sorted). */
  hosts: Record<string, Record<string, unknown>>;
}

/** One host's source-attributed inventory entry (ADR 0013 §7). */
export interface InventoryHostEntry {
  /** Resolved vars for this host (defaults < group_all < groups < host). */
  vars: Record<string, unknown>;
  /** Groups this host belongs to. */
  groups: string[];
}

/** One group's membership + declared group_vars (ADR 0013 §7). */
export interface InventoryGroupEntry {
  /** Member hosts of this group. */
  hosts: string[];
  /** Declared group_vars for this group. */
  vars: Record<string, unknown>;
}

/** Full inventory snapshot backing the `inv` namespace — every host (not just
 *  matched) with resolved vars + group membership, every group with members +
 *  group_vars, plus inventory-level defaults. */
export interface InventorySnapshot {
  hosts: Record<string, InventoryHostEntry>;
  groups: Record<string, InventoryGroupEntry>;
  defaults: Record<string, unknown>;
}

export type VarLookup =
  | { found: true; value: unknown }
  | { found: false; reason: "unknown_host" | "unknown_variable" };

// ---------------------------------------------------------------------------
// Internal graph
// ---------------------------------------------------------------------------

interface InventoryGraph {
  hosts: Set<string>;
  groupHosts: Record<string, Set<string>>;
  groupVars: Record<string, Record<string, unknown>>;
  hostVars: Record<string, Record<string, unknown>>;
  defaults: Record<string, unknown>;
  children: Record<string, string[]>;
}

function emptyGraph(): InventoryGraph {
  return {
    hosts: new Set(),
    groupHosts: {},
    groupVars: {},
    hostVars: {},
    defaults: {},
    children: {},
  };
}

function mergeContribution(g: InventoryGraph, c: PluginContribution): void {
  for (const h of c.hosts) g.hosts.add(h);
  for (const [gname, hosts] of Object.entries(c.groupHosts ?? {})) {
    if (!g.groupHosts[gname]) g.groupHosts[gname] = new Set();
    for (const h of hosts) g.groupHosts[gname]!.add(h);
  }
  for (const [gname, vars] of Object.entries(c.groupVars ?? {})) {
    g.groupVars[gname] = { ...(g.groupVars[gname] ?? {}), ...vars };
  }
  for (const [h, vars] of Object.entries(c.hostVars ?? {})) {
    g.hostVars[h] = { ...(g.hostVars[h] ?? {}), ...vars };
  }
  g.defaults = { ...g.defaults, ...(c.defaults ?? {}) };
  for (const [parent, children] of Object.entries(c.children ?? {})) {
    g.children[parent] = [...(g.children[parent] ?? []), ...children];
  }
}

async function buildGraph(
  inventory: NormalizedInventory,
  options: ResolveOptions,
): Promise<InventoryGraph> {
  const g = emptyGraph();
  // Static layer from the in-memory normalized inventory.
  mergeContribution(g, await createStaticPlugin(inventory).resolve({ inventory }));
  // Option layers.
  if (options.defaults) g.defaults = { ...g.defaults, ...options.defaults };
  for (const [gname, vars] of Object.entries(options.groupVars ?? {})) {
    g.groupVars[gname] = { ...(g.groupVars[gname] ?? {}), ...vars };
  }
  for (const [h, vars] of Object.entries(options.hostVars ?? {})) {
    g.hostVars[h] = { ...(g.hostVars[h] ?? {}), ...vars };
  }
  for (const [parent, children] of Object.entries(options.children ?? {})) {
    g.children[parent] = [...(g.children[parent] ?? []), ...children];
  }
  // Plugin layers.
  const plugins = options.plugins ?? getDynamicPlugins();
  for (const p of plugins) {
    const c = await p.resolve({ inventory });
    mergeContribution(g, c);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Target expansion
// ---------------------------------------------------------------------------

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function expandGroupRecursive(
  gname: string,
  g: InventoryGraph,
  out: Set<string>,
): void {
  const direct = g.groupHosts[gname];
  if (direct) for (const h of direct) out.add(h);
  for (const child of g.children[gname] ?? []) {
    expandGroupRecursive(child, g, out);
  }
}

function expandTargets(
  targets: string[],
  g: InventoryGraph,
  allGroupName: string,
): string[] {
  const result = new Set<string>();
  const allHosts = [...g.hosts].sort();
  for (const target of targets) {
    if (target === "all") {
      for (const h of allHosts) result.add(h);
      continue;
    }
    if (target.endsWith(":children")) {
      const gname = target.slice(0, -":children".length);
      expandGroupRecursive(gname, g, result);
      continue;
    }
    // Group name?
    if (g.groupHosts[target]) {
      for (const h of g.groupHosts[target]!) result.add(h);
      continue;
    }
    // Glob?
    if (target.includes("*")) {
      const re = globToRegExp(target);
      for (const h of allHosts) if (re.test(h)) result.add(h);
      for (const gname of Object.keys(g.groupHosts)) {
        if (re.test(gname)) for (const h of g.groupHosts[gname]!) result.add(h);
      }
      continue;
    }
    // Literal host (unknown hosts are silently ignored — no crash).
    if (g.hosts.has(target)) result.add(target);
  }
  return [...result].sort();
}

// ---------------------------------------------------------------------------
// Precedence resolution
// ---------------------------------------------------------------------------

/**
 * @summary Compute the deterministic, root-first merge order of a host's groups:
 * its direct memberships plus their transitive ancestors, ordered so a parent is
 * merged before its child (child overrides parent). Same-depth groups are ordered
 * by name, so groups with no parent/child relationship among them keep the legacy
 * sorted-name merge order. `allGroupName` is excluded (merged separately as the
 * group_all layer). Each group appears at most once even when reachable via
 * several paths.
 * @param host Target host name.
 * @param g Inventory graph (membership + `children` parent→child edges).
 * @param allGroupName Name of the implicit all-groups layer.
 * @returns Parent-before-child ordered group names.
 */
function orderedGroupsForHost(
  host: string,
  g: InventoryGraph,
  allGroupName: string,
): string[] {
  const direct = Object.keys(g.groupHosts).filter(
    (gname) => gname !== allGroupName && g.groupHosts[gname]!.has(host),
  );
  if (direct.length === 0) return [];

  const parents: Record<string, string[]> = {};
  for (const [parent, kids] of Object.entries(g.children)) {
    for (const child of kids) (parents[child] ??= []).push(parent);
  }

  const closure = new Set<string>();
  const stack = [...direct];
  while (stack.length > 0) {
    const name = stack.pop()!;
    if (name === allGroupName || closure.has(name)) continue;
    closure.add(name);
    for (const p of parents[name] ?? []) stack.push(p);
  }

  // Depth = longest ancestor chain within the closure; deeper = nearer descendant.
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (name: string): number => {
    const cached = depth.get(name);
    if (cached !== undefined) return cached;
    if (visiting.has(name)) return 0;
    visiting.add(name);
    let d = 0;
    for (const p of parents[name] ?? []) {
      if (closure.has(p)) d = Math.max(d, depthOf(p) + 1);
    }
    visiting.delete(name);
    depth.set(name, d);
    return d;
  };

  return [...closure].sort((a, b) => {
    const da = depthOf(a);
    const db = depthOf(b);
    if (da !== db) return da - db;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function resolveHostVars(
  host: string,
  g: InventoryGraph,
  allGroupName: string,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  // 1. defaults (lowest)
  Object.assign(merged, g.defaults);
  // 2. group_all (applies to every host)
  Object.assign(merged, g.groupVars[allGroupName] ?? {});
  // 3. group vars (root-first: ancestors before descendants so children override parents)
  for (const gname of orderedGroupsForHost(host, g, allGroupName)) {
    Object.assign(merged, g.groupVars[gname] ?? {});
  }
  // 4. host vars (highest)
  Object.assign(merged, g.hostVars[host] ?? {});
  return merged;
}

// ---------------------------------------------------------------------------
// Determinism helper
// ---------------------------------------------------------------------------

export function sortedRecord(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(input).sort()) out[k] = input[k];
  return out;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function resolveTargets(
  inventory: NormalizedInventory,
  targets: string[],
  options: ResolveOptions = {},
): Promise<ResolvedInventory> {
  const allGroupName = options.allGroupName ?? "all";
  const g = await buildGraph(inventory, options);
  const matched = expandTargets(targets, g, allGroupName);
  const hosts: Record<string, Record<string, unknown>> = {};
  for (const h of matched) {
    hosts[h] = sortedRecord(resolveHostVars(h, g, allGroupName));
  }
  return { matchedHosts: matched, hosts };
}

// ---------------------------------------------------------------------------
// Full inventory snapshot (every host + every group) for the `inv` namespace
// ---------------------------------------------------------------------------

/**
 * Resolve the ENTIRE inventory graph (not just matched targets) into a
 * source-attributed snapshot backing the `inv` namespace (ADR 0013 §7). Unlike
 * {@link resolveTargets}, this returns every host with its merged vars + group
 * membership and every group with its members + declared group_vars, enabling
 * cross-host reads (`inv.hosts.<OTHER>`) and gap inspection against `vars`.
 * @param inventory Normalized inventory model.
 * @param options Same resolution options as {@link resolveTargets}.
 * @returns The full {@link InventorySnapshot}.
 */
export async function resolveInventorySnapshot(
  inventory: NormalizedInventory | null,
  options: ResolveOptions = {},
): Promise<InventorySnapshot> {
  if (!inventory) return { hosts: {}, groups: {}, defaults: {} };
  const allGroupName = options.allGroupName ?? "all";
  const g = await buildGraph(inventory, options);

  const hosts: Record<string, InventoryHostEntry> = {};
  for (const h of [...g.hosts].sort()) {
    const groups = Object.keys(g.groupHosts)
      .filter((gname) => g.groupHosts[gname]!.has(h))
      .sort();
    hosts[h] = { vars: sortedRecord(resolveHostVars(h, g, allGroupName)), groups };
  }

  const groups: Record<string, InventoryGroupEntry> = {};
  for (const gname of Object.keys(g.groupHosts).sort()) {
    groups[gname] = {
      hosts: [...g.groupHosts[gname]!].sort(),
      vars: sortedRecord(g.groupVars[gname] ?? {}),
    };
  }

  return { hosts, groups, defaults: sortedRecord(g.defaults) };
}

// ---------------------------------------------------------------------------
// Safe variable lookup (no NaN / no crash on unknown access)
// ---------------------------------------------------------------------------

export function lookupVar(
  resolved: ResolvedInventory,
  host: string,
  key: string,
): VarLookup {
  const hostVars = resolved.hosts[host];
  if (!hostVars) return { found: false, reason: "unknown_host" };
  if (!(key in hostVars)) return { found: false, reason: "unknown_variable" };
  return { found: true, value: hostVars[key] };
}
