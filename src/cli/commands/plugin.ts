// `rolecall plugin [...]` (Wave 2 module-parity increment).
//
// Completes the Plugin SDK: `plugin register <name> --path <file>` loads and
// persists a user module (or fact declaration) so it is dispatchable by
// `playbook run` and visible to `rolecall docs modules` / `var_strict`. `plugin list`
// merges built-in inventory plugins with registered module/fact plugins.

import { loadModuleFromFile } from "../../modules/loader";
import { listInventoryPlugins } from "../../inventory/plugin";
import { registerFactPlugin } from "../../facts/engine";
import {
  globalRolecallDir,
  listPlugins,
  registerPlugin,
  removePlugin,
  type PluginManifestEntry,
  type PluginType,
} from "../../store/plugin-store";
import {
  type CliResult,
  CliError,
  type GlobalFlags,
  type PluginEntryView,
  type PluginListResult,
  type PluginRegisterResult,
} from "../types";

/** @summary Auto-load every registered plugin at CLI startup so `playbook run` can dispatch user modules and `var_strict` recognizes their declared facts. Broken entries are skipped (warned) so one bad plugin never aborts the whole invocation. */
export async function loadRegisteredPlugins(): Promise<void> {
  for (const entry of listPlugins()) {
    try {
      if (entry.type === "module") {
        await loadModuleFromFile(entry.path);
      } else {
        registerFactPlugin({
          name: `plugin:${entry.name}`,
          gatherers: [],
          declares: entry.declaredFacts ?? [],
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`warn: skipping plugin '${entry.name}': ${msg}\n`);
    }
  }
}

/** @summary Handle `plugin list | register | remove`. @param rest Args after `plugin` (subcommand + flags). @param _flags Parsed global flags (unused: plugin output is human-stable). @returns A structured `CliResult` for the output plugin. */
export async function runPluginCommand(
  rest: string[],
  _flags: GlobalFlags,
): Promise<CliResult> {
  const action = rest[0] ?? "list";

  if (action === "list") {
    const plugins: PluginEntryView[] = listPlugins().map((e) => ({
      name: e.name,
      type: e.type,
      source: "plugin",
      path: e.path,
    }));
    for (const inv of listInventoryPlugins()) {
      const name = typeof inv === "string" ? inv : (inv as { name: string }).name;
      plugins.push({ name, type: "inventory", source: "inventory" });
    }
    plugins.sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
    const result: PluginListResult = {
      command: "plugin list",
      plugins,
      note: "module/fact plugins are registered via `plugin register`; inventory plugins are built-in",
    };
    return result;
  }

  if (action === "register") {
    let name: string | undefined;
    let path: string | undefined;
    let global = false;
    let type: PluginType = "module";
    for (let i = 1; i < rest.length; i++) {
      const a = rest[i]!;
      if (a === "--path") path = rest[++i];
      else if (a === "--global") global = true;
      else if (a === "--type") {
        const t = rest[++i];
        if (t !== "module" && t !== "fact") throw new CliError(true, "plugin register --type must be 'module' or 'fact'");
        type = t;
      } else if (!name && !a.startsWith("--")) name = a;
    }
    if (!name) throw new CliError(true, "plugin register requires a <name>");
    if (!path) throw new CliError(true, "plugin register requires --path <file>");

    const mod = await loadModuleFromFile(path);
    const entry: PluginManifestEntry = {
      type,
      name: mod.name,
      path,
      declaredFacts: mod.facts ? [...mod.facts] : undefined,
    };
    registerPlugin(entry, global ? { globalRoot: globalRolecallDir() } : { root: process.cwd() });
    const result: PluginRegisterResult = {
      command: "plugin register",
      name: mod.name,
      type,
      path,
      registered: true,
      note: `registered ${entry.type} plugin '${mod.name}' from ${path}` +
        (mod.facts?.length ? ` (declares ${mod.facts.length} fact(s))` : ""),
    };
    return result;
  }

  if (action === "remove") {
    const name = rest[1];
    if (!name) throw new CliError(true, "plugin remove requires a <name>");
    const removed = removePlugin(name, "module", { root: process.cwd() });
    const result: PluginListResult = {
      command: "plugin list",
      plugins: [],
      note: removed ? `removed plugin '${name}'` : `no plugin '${name}' found`,
    };
    return result;
  }

  throw new CliError(
    true,
    `unknown plugin subcommand '${action}' (expected: list | register | remove)`,
  );
}
