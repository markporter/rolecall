import { dirname } from "node:path";
import { CliError, type CliResult, type GlobalFlags } from "../types";
import { loadPlaybookFile, loadInventoryFile } from "../../config/loader";
import { FsProjectSource } from "../../vfs/fs-project-source.js";
import {
  resolveVarOrigins,
  resolveDirectoryVarOrigins,
  inventoryLayersForHost,
  type VarOriginMap,
  type VarResolution,
} from "../../config/var-trace.js";
import { BUILTIN_GATHERERS } from "../../facts/gatherers.js";
import { getRegisteredFactPlugins } from "../../facts/engine.js";
import { parseExtraVars } from "../parse-extra-vars.js";
import type { ConnectionKind } from "../../facts/types.js";
import type { VarManifestEntry } from "../../config/var-manifest/types.js";
import type { NormalizedInventory } from "../../config/schema.js";
import { resolveTargets } from "../../inventory/engine.js";

const CONNECTION_KINDS: ConnectionKind[] = ["ssh", "local", "network", "http"];

/**
 * @summary Dispatch the `vars` command: `list` (declared catalog by file + fact capability) or
 * `trace` (Splunk-btool-style precedence/override view per host).
 * @param sub Subcommand: `list` | `trace`.
 * @param rest Positional args (playbook path first).
 * @param flags Parsed global flags (inventory, extra-vars, limit).
 * @returns A structured {@link CliResult} rendered by the output plugin.
 */
export async function runVarsCommand(
  sub: string | undefined,
  rest: string[],
  _flags: GlobalFlags,
): Promise<CliResult> {
  if (sub === "list") return runList(rest);
  if (sub === "trace") return runTrace(rest, _flags);
  throw new CliError(true, `unknown vars subcommand '${sub ?? ""}' (expected: list | trace)`);
}

/** @summary `vars list <playbook>`: every declared var/fact grouped by its declaring file, plus the observable-fact capability set. */
async function runList(rest: string[]): Promise<CliResult> {
  const playbookPath = rest[0];
  if (!playbookPath) throw new CliError(true, "vars list expects a playbook path");
  const plays = await loadPlaybookFile(playbookPath);

  const byFile = new Map<string, VarManifestEntry[]>();
  for (const play of plays) {
    for (const entry of play.varManifests ?? []) {
      const file = entry.declaredIn ?? "<inline>";
      const list = byFile.get(file) ?? [];
      list.push(entry);
      byFile.set(file, list);
    }
  }
  const declared = [...byFile.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, entries]) => ({ file, entries: entries.sort((x, y) => x.name.localeCompare(y.name)) }));

  const factsByKind = {} as Record<ConnectionKind, string[]>;
  for (const k of CONNECTION_KINDS) factsByKind[k] = [];
  const addGatherer = (provides: readonly string[], connectionKinds?: readonly ConnectionKind[]): void => {
    const ks = connectionKinds ?? CONNECTION_KINDS;
    for (const k of ks) {
      const bucket = factsByKind[k] ?? (factsByKind[k] = []);
      for (const p of provides) if (!bucket.includes(p)) bucket.push(p);
    }
  };
  for (const g of BUILTIN_GATHERERS) addGatherer(g.provides, g.connectionKinds);
  for (const plugin of getRegisteredFactPlugins()) {
    for (const g of plugin.gatherers) addGatherer(g.provides, g.connectionKinds);
  }
  for (const k of CONNECTION_KINDS) factsByKind[k].sort();

  return { command: "vars list", declared, factsByKind };
}

/**
 * @summary `vars trace <playbook> [--inventory <inv>] [--extra-vars <kv>] [--limit <host>]`:
 * for each play, resolve every variable's winning value + the file/layer that set it, with the
 * full override chain (role-default < role-vars < inventory < play < extra-vars).
 */
async function runTrace(rest: string[], flags: GlobalFlags): Promise<CliResult> {
  const playbookPath = rest[0];
  if (!playbookPath) throw new CliError(true, "vars trace expects a playbook path");
  const plays = await loadPlaybookFile(playbookPath);

  let inventory: NormalizedInventory | undefined;
  let invOrigins: Awaited<ReturnType<typeof resolveDirectoryVarOrigins>> | undefined;
  if (flags.inventory) {
    const source = new FsProjectSource(dirname(flags.inventory));
    inventory = await loadInventoryFile(flags.inventory, source);
    invOrigins = await resolveDirectoryVarOrigins(flags.inventory, source);
  }

  const extraLayer: VarOriginMap = {};
  for (const [k, v] of Object.entries(parseExtraVars(flags.extraVars))) {
    extraLayer[k] = { value: v, tier: "extra" };
  }

  const resultPlays: Array<{ name?: string; hosts: Record<string, Record<string, VarResolution>> }> = [];
  for (const play of plays) {
    const hosts: Record<string, Record<string, VarResolution>> = {};
    const matched =
      inventory !== undefined
        ? (await resolveTargets(inventory, play.hosts, {})).matchedHosts
        : [...play.hosts];
    const limit = flags.limit;
    const targetHosts = limit ? matched.filter((h) => h.includes(limit)) : matched;

    for (const host of targetHosts) {
      const layers: VarOriginMap[] = [];
      if (play.varOrigins) layers.push(play.varOrigins);
      if (invOrigins && inventory) {
        layers.push(...inventoryLayersForHost(invOrigins, inventory, host));
      }
      const playLayer: VarOriginMap = {};
      for (const [k, v] of Object.entries(play.vars)) {
        playLayer[k] = { value: v, tier: "play", file: playbookPath };
      }
      layers.push(playLayer, extraLayer);
      hosts[host] = resolveVarOrigins(layers);
    }
    resultPlays.push({ name: play.name, hosts });
  }

  return { command: "vars trace", plays: resultPlays };
}
