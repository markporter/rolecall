// `rolecall inventory show|list [inv]` (Wave 1, Todo 5).
//
// SCOPE: wire the inventory loader + engine.
//   - show : resolve every host ("all") and print the per-host var map.
//   - list : print the sorted group names.
// The loader (`src/config/loader.ts`) auto-detects the inventory format, so both
// native `groups:` YAML and Ansible INI/YAML inventories are accepted directly.
// No transport / templating / file mutation.

import { dirname } from "node:path";

import { loadInventoryFile, resolveDirectoryVars } from "../../config/loader";
import { resolveTargets } from "../../inventory/engine";
import { FsProjectSource } from "../../vfs/fs-project-source";
import { CliError, type CliResult, type GlobalFlags } from "../types";

export async function runInventoryCommand(
  sub: string | undefined,
  rest: string[],
  _flags: GlobalFlags,
): Promise<CliResult> {
  if (sub !== "show" && sub !== "list") {
    throw new CliError(
      true,
      `unknown inventory subcommand '${sub ?? ""}' (expected: show | list)`,
    );
  }
  const inventoryPath = rest[0];
  if (!inventoryPath) {
    throw new CliError(true, `inventory ${sub} requires an <inv> argument`);
  }

  const source = new FsProjectSource(dirname(inventoryPath));
  const inventory = await loadInventoryFile(inventoryPath, source);
  const dirVars = await resolveDirectoryVars(inventoryPath, source);

  if (sub === "show") {
    const resolved = await resolveTargets(inventory, ["all"], {
      groupVars: dirVars.groupVarsByGroup,
      hostVars: dirVars.hostVarsByHost,
    });
    return {
      command: "inventory show",
      inventory: inventoryPath,
      matchedHosts: resolved.matchedHosts,
      hosts: resolved.hosts,
    };
  }

  return {
    command: "inventory list",
    inventory: inventoryPath,
    groups: Object.keys(inventory.groups).sort(),
  };
}
