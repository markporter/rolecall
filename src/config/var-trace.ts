// Variable provenance tracing — a Splunk-btool-style view of "which file/layer set each var".
//
// This is a PURE, ADDITIVE surface. The executor's hot path (executor/engine.ts applyPlayVars)
// is untouched; this module is consulted only by the `vars trace` command, which re-merges the
// same precedence tiers with origin metadata retained so overrides are traceable.

import { basename, extname } from "node:path";
import { load as yamlLoad } from "js-yaml";
import type { ProjectSource } from "../vfs/project-source.js";

/**
 * @summary Precedence tier a variable contribution came from (lowest → highest).
 */
export type VarTier =
  | "role-default"
  | "role-vars"
  | "inv-default"
  | "inv-group"
  | "inv-host"
  | "play"
  | "extra";

/**
 * @summary One contributing assignment to a variable, tagged with its precedence tier and source file.
 */
export interface VarOrigin {
  value: unknown;
  tier: VarTier;
  /** Source file that supplied the value (absent for `--extra-vars`, which has no file). */
  file?: string;
}

/** @summary Map of variable name → its single contribution at one precedence tier. */
export type VarOriginMap = Record<string, VarOrigin>;

/**
 * @summary Resolved view of a variable: the winning value plus the full chain of contributions
 * (lowest → highest tier) that defined it, so overrides are traceable.
 */
export interface VarResolution {
  name: string;
  value: unknown;
  tier: VarTier;
  file?: string;
  chain: VarOrigin[];
}

/**
 * @summary Merge ordered precedence tiers into a per-variable resolution with a full override chain.
 * @param layers Tiers in ascending precedence (index 0 is lowest; the last layer wins).
 * @returns Variable name → resolution (winning value + ordered chain of every contribution).
 */
export function resolveVarOrigins(layers: VarOriginMap[]): Record<string, VarResolution> {
  const names = new Set<string>();
  for (const layer of layers) for (const k of Object.keys(layer)) names.add(k);
  const out: Record<string, VarResolution> = {};
  for (const name of names) {
    const chain: VarOrigin[] = [];
    for (const layer of layers) {
      const o = layer[name];
      if (o !== undefined) chain.push(o);
    }
    const winning = chain[chain.length - 1]!;
    out[name] = { name, value: winning.value, tier: winning.tier, file: winning.file, chain };
  }
  return out;
}

/** Origin-tagged directory-adjacent group/host vars (mirrors resolveDirectoryVars but retains file paths). */
export interface DirectoryVarOrigins {
  groupVarsByGroup: Record<string, VarOriginMap>;
  hostVarsByHost: Record<string, VarOriginMap>;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @summary Discover `group_vars/` and `host_vars/` files next to an inventory and parse them into
 * origin-tagged var maps (each entry records the file that supplied it). Pure variant of
 * `resolveDirectoryVars` for provenance tracing; the inventory engine itself is untouched.
 * @param inventoryPath Inventory file path (used only to anchor discovery; scan runs under `source.root`).
 * @param source Project VFS rooted at the inventory file's directory.
 * @returns Per-group and per-host origin-tagged var maps.
 */
export async function resolveDirectoryVarOrigins(
  inventoryPath: string,
  source: ProjectSource,
): Promise<DirectoryVarOrigins> {
  void inventoryPath;
  const groupVarsByGroup: Record<string, VarOriginMap> = {};
  const hostVarsByHost: Record<string, VarOriginMap> = {};

  const groupFiles = await source.listFiles("group_vars/*.yaml");
  for (const file of groupFiles) {
    const name = basename(file, extname(file));
    if (!name) continue;
    const text = await source.readText(file);
    const data = yamlLoad(text);
    const map: VarOriginMap = {};
    if (isPlainRecord(data)) {
      for (const [k, v] of Object.entries(data)) map[k] = { value: v, tier: "inv-group", file };
    }
    groupVarsByGroup[name] = map;
  }

  const hostFiles = await source.listFiles("host_vars/*.yaml");
  for (const file of hostFiles) {
    const name = basename(file, extname(file));
    if (!name) continue;
    const text = await source.readText(file);
    const data = yamlLoad(text);
    const map: VarOriginMap = {};
    if (isPlainRecord(data)) {
      for (const [k, v] of Object.entries(data)) map[k] = { value: v, tier: "inv-host", file };
    }
    hostVarsByHost[name] = map;
  }

  return { groupVarsByGroup, hostVarsByHost };
}

/**
 * @summary Build the inventory precedence layers (group_all < groups < host) for one host as ordered
 * {@link VarOriginMap}s, ready to feed {@link resolveVarOrigins}.
 * @param origins Origin-tagged directory vars from {@link resolveDirectoryVarOrigins}.
 * @param inventory Structural inventory (group → host membership) used to pick a host's groups.
 * @param host Target host name.
 * @param allGroupName Name treated as "applies to every host" (default `all`).
 * @returns Ordered inventory layers (group_all first, then sorted group names, then host vars).
 */
export function inventoryLayersForHost(
  origins: DirectoryVarOrigins,
  inventory: { groups: Record<string, { hosts: string[] }> },
  host: string,
  allGroupName = "all",
): VarOriginMap[] {
  const layers: VarOriginMap[] = [];
  const all = origins.groupVarsByGroup[allGroupName];
  if (all) layers.push(all);
  const groupsOfHost = Object.keys(inventory.groups)
    .filter((g) => (inventory.groups[g]?.hosts ?? []).includes(host))
    .sort();
  for (const g of groupsOfHost) {
    const m = origins.groupVarsByGroup[g];
    if (m) layers.push(m);
  }
  const hostMap = origins.hostVarsByHost[host];
  if (hostMap) layers.push(hostMap);
  return layers;
}
