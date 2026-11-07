// `rolecall facts gather <inventory> [--limit]` (Wave 1, Todo 5).
//
// Resolves the inventory's target patterns, then builds a per-host connection
// via the shared factory (`src/cli/connections.ts`) and collects facts through
// the built-in engine (`defaultFactsEngine.gatherFacts`). One unreachable host is
// isolated: its error lands in `failures` so the rest of the run still completes.
// No transport state is mutated here beyond each connection's connect/disconnect.

import { dirname } from "node:path";
import { loadInventoryFile, resolveDirectoryVars } from "../../config/loader";
import { resolveTargets } from "../../inventory/engine";
import { defaultFactsEngine } from "../../facts/engine";
import { FsProjectSource } from "../../vfs/fs-project-source";
import { loadIsolationConfig, mergeEgress, mergeMounts, policyFor } from "../../isolation/config";
import type { FactMap } from "../../facts/types";
import { buildConnectionForHost } from "../connections";
import type { IsolationOptions } from "../../isolation/types";
import { CliError, type CliResult, type GlobalFlags } from "../types";

export async function runFactsCommand(
  sub: string | undefined,
  rest: string[],
  flags: GlobalFlags,
): Promise<CliResult> {
  if (sub !== "gather") {
    throw new CliError(
      true,
      `unknown facts subcommand '${sub ?? ""}' (expected: gather)`,
    );
  }
  const inventoryPath = rest[0];
  if (!inventoryPath) {
    throw new CliError(true, "facts gather requires an <inventory> argument");
  }

  const source = new FsProjectSource(dirname(inventoryPath));
  const inventory = await loadInventoryFile(inventoryPath, source);
  const dirVars = await resolveDirectoryVars(inventoryPath, source);
  const targets = flags.limit ? [flags.limit] : ["all"];
  const resolved = await resolveTargets(inventory, targets, {
    groupVars: dirVars.groupVarsByGroup,
    hostVars: dirVars.hostVarsByHost,
  });
  const matchedHosts = resolved.matchedHosts;
  const varsByHost = resolved.hosts;

  // Connect + gather per host; isolate any single-host failure into `failures`.
  const facts: Record<string, FactMap> = {};
  const failures: Record<string, string> = {};
  const isolation: IsolationOptions | undefined = flags.isolation
    ? {
        backend: flags.isolation,
        projectRoot: process.cwd(),
        network: flags.isolationNetwork === "none" ? "off" : flags.isolationNetwork === "all" ? "on" : "module",
        ...(flags.mounts ? { mounts: flags.mounts } : {}),
        ...(flags.allowEgress ? { egress: flags.allowEgress } : {}),
      }
    : undefined;
  if (isolation && isolation.backend !== "none") {
    const projectPolicy = policyFor(loadIsolationConfig(), source.uri);
    isolation.mounts = mergeMounts(isolation.mounts, projectPolicy);
    isolation.egress = mergeEgress(isolation.egress, projectPolicy);
  }
  for (const host of matchedHosts) {
    try {
      const conn = buildConnectionForHost(host, varsByHost[host] ?? {}, { isolation });
      await conn.connect();
      try {
        facts[host] = await defaultFactsEngine.gatherFacts(conn, [], {});
      } finally {
        await conn.disconnect();
      }
    } catch (err) {
      failures[host] = err instanceof Error ? err.message : String(err);
    }
  }

  const collectedCount = Object.keys(facts).length;
  const failedNames = Object.keys(failures);
  let note =
    `${collectedCount}/${matchedHosts.length} host(s) had fact maps gathered` +
    (failedNames.length > 0
      ? `; FAILED on ${failedNames.join(", ")}`
      : "; no failures");

  return {
    command: "facts gather",
    inventory: inventoryPath,
    limit: flags.limit,
    resolvedHosts: matchedHosts,
    facts,
    failures,
    note,
  };
}
