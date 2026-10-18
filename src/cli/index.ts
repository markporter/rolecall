// RoleCall unified CLI entrypoint (Wave 1, Todo 5).
//
// Parses argv ONCE with node:util `parseArgs` (no extra dependency), splits the
// global flags from the subcommand positionals, then dispatches to the per-
// command handlers in ./commands. Each handler returns a structured `CliResult`;
// the selected output plugin (./output) renders it. Unknown subcommands / bad
// args exit non-zero with a helpful message (never a stack trace).
//
// This file is ALSO the barrel: it re-exports the command handlers + output
// registry so later waves (executor, server) can `import` from "../cli" without
// triggering `main()` (guarded by `import.meta.main`).

import { parseArgs } from "node:util";

// Bundled package metadata. Under `bun build --compile` this is inlined as a
// JSON module, so getVersion() needs NO filesystem read inside the standalone
// binary (a manual Bun.file("../../package.json") would otherwise resolve into
// Bun's temp-extraction dir where the sibling file was never extracted).
import pkg from "../../package.json";

import {
  getOutputPlugin,
  listOutputPlugins,
  renderOutput,
} from "./output";
import { runFactsCommand } from "./commands/facts";
import { runInventoryCommand } from "./commands/inventory";
import { runPlaybookCommand } from "./commands/playbook";
import { runPluginCommand, loadRegisteredPlugins } from "./commands/plugin";
import { runReplayCommand } from "./commands/run";
import { runAgentCommand } from "./commands/agent";
import { runDocsCommand } from "./commands/docs";
import { runVarsCommand } from "./commands/vars";
import { CliError, type CliResult, type GlobalFlags } from "./types";

export { runPlaybookCommand } from "./commands/playbook";
export { runFactsCommand } from "./commands/facts";
export { runInventoryCommand } from "./commands/inventory";
export { runPluginCommand } from "./commands/plugin";
export { runReplayCommand } from "./commands/run";
export { runAgentCommand } from "./commands/agent";
export { runDocsCommand } from "./commands/docs";
export { runVarsCommand } from "./commands/vars";
export {
  getOutputPlugin,
  listOutputPlugins,
  registerOutputPlugin,
  renderOutput,
  type OutputPlugin,
} from "./output";
export * from "./types";

/** Usage/help text printed by `rolecall --help` and when no subcommand is given. */
const HELP = `RoleCall — config mgmt & orchestration

Usage:
  rolecall [global-flags] <command> [subcommand] [args]

Global flags (parsed once, injected downward):
  --output <plugin>   Output plugin: syslog (default for playbook runs) | human_summary | json
                       syslog streams per-task JSON lines for playbook run; inspection
                       commands fall back to human_summary unless -o is given
  --limit <hosts>     Restrict target hosts (single pattern)
  --inventory <file>  Inventory source (native YAML or Ansible INI/YAML, auto-detected)
  --extra-vars <kv>   Runtime vars: space-separated key=value pairs (highest precedence)
  --tags <list>       Run only tasks carrying any listed tag (comma-separated)
  --skip-tags <list>  Exclude tasks carrying any listed tag (comma-separated; wins over --tags)
  --force             Accepted (compute-only; executor pending)
  --check             Accepted (compute-only; executor pending)
  --diff              Accepted (compute-only; executor pending)
  --forks <N>         Concurrency fan-out (number)
  --trace             Emit + persist an execution-trace ledger for the run
  --profile           Print a per-host/per-task performance profile at run end
  --resume <run_id>:<checkpoint>  Resume a prior run from a checkpoint (Todo 26)
  --help, -h          Show this help
  --version, -v       Show version

Serve mode (rolecall --serve, see src/orchestrator):
   --serve             Start the orchestrator HTTP server
   --dist <dir>        Alias for --ui-dist (directory served as the static UI)
   --ui-dist <dir>     Directory served as the pluggable SPA (env ROLECALL_UI_DIST).
                       Unset => zero-build health JSON on GET /; set+missing => guidance.
   --port <N>          Listen port (env ROLECALL_SERVE_PORT, default 8080)
   --host <H>          Listen host (env ROLECALL_SERVE_HOST, default 127.0.0.1)

Subcommands:
   playbook run <file> [--inventory <inv>] [--limit] [--force] [--check] [--diff] [--forks N] [--extra-vars <kv>] [--tags <list>] [--skip-tags <list>] [--trace] [--profile]
                       Parse + resolve inventory + print a dry-run skeleton (no exec)
   run replay <id>     Re-emit a stored run's execution-trace ledger (--trace/--profile)
   facts gather <inv> [--limit]
                       Resolve inventory targets (facts gathering pending)
    inventory show <inv>
                       Print resolved hosts + per-host vars
    inventory list <inv>
                        List group names

     vars list <play>   Show every declared var/fact by file + fact capability per connection kind
     vars trace <play> [--inventory <inv>] [--extra-vars <kv>] [--limit <host>]
                        Splunk-btool-style precedence/override view (winning value + file/layer + chain)
     agent manifest     Emit the clientless agent tool-spec manifest (identical to GET /mcp)
    docs search <query>  Query RoleCall prose docs by substring (matches sections; use -o json for structured output)
    docs modules [<term>]  List every RoleCall module (name + description + args); optional <term> filter; -o json for structured output
     plugin list                                List registered module/fact plugins + built-in inventory plugins
     plugin register <name> --path <file> [--global]   Persist a user module so 'playbook run' can dispatch it
 `;

// Global flag definitions for parseArgs. Every subcommand flag is global, so the
// whole argv is parsed in one pass and positionals carry the subcommand path.
/**
 * `parseArgs` option definitions for every global flag parsed once from argv.
 */
const GLOBAL_OPTS = {
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
  output: { type: "string", short: "o", default: "syslog" },
  limit: { type: "string" },
  inventory: { type: "string" },
  force: { type: "boolean" },
  check: { type: "boolean" },
  diff: { type: "boolean" },
  forks: { type: "string" },
  "extra-vars": { type: "string", short: "e" },
  tags: { type: "string" },
  "skip-tags": { type: "string" },
  trace: { type: "boolean" },
  profile: { type: "boolean" },
  resume: { type: "string" },
  json: { type: "boolean" },
} as const;

/** @summary Write rendered CLI output to stdout, stripping NUL/control chars from the `json` stream so a polluted data channel never breaks a downstream JSON parser. @param text Rendered text to emit. @param output Selected output plugin name; only `json` gets control-char scrubbing. */
export function writeOut(text: string, output: string = "syslog"): void {
  if (output === "json") {
    const cleaned = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
    process.stdout.write(cleaned);
    return;
  }
  process.stdout.write(text);
}

function writeErr(text: string): void {
  process.stderr.write(text);
}

/** @summary Return RoleCall's semantic version from the bundled package metadata. Performs no filesystem read, so it works identically when run from source and when compiled into a standalone binary. */
export async function getVersion(): Promise<string> {
  return pkg.version;
}

function buildFlags(values: Record<string, unknown>): GlobalFlags {
  const forksRaw = values["forks"] as string | undefined;
  let forks: number | undefined;
  if (forksRaw !== undefined) {
    const n = Number(forksRaw);
    if (!Number.isFinite(n)) {
      throw new CliError(true, `--forks must be a number (got '${forksRaw}')`);
    }
    forks = n;
  }
  return {
    limit: values["limit"] as string | undefined,
    force: (values["force"] as boolean | undefined) ?? false,
    check: (values["check"] as boolean | undefined) ?? false,
    diff: (values["diff"] as boolean | undefined) ?? false,
    forks,
    inventory: values["inventory"] as string | undefined,
    trace: (values["trace"] as boolean | undefined) ?? false,
    profile: (values["profile"] as boolean | undefined) ?? false,
    resume: values["resume"] as string | undefined,
    extraVars: values["extra-vars"] as string | undefined,
    tags: values["tags"] as string | undefined,
    skipTags: values["skip-tags"] as string | undefined,
    // --json is a convenience shorthand for --output json (used by the docs
    // subcommands and any other command the user wants structured output from).
    output: (values["json"] as boolean | undefined)
      ? "json"
      : ((values["output"] as string | undefined) ?? "syslog"),
  };
}

/**
 * Run RoleCall's unified entrypoint: boot the orchestrator when `--serve` is present,
 * else parse global flags and dispatch the requested subcommand handler, returning
 * a process exit code (0 success, 1/2 error).
 */

/** @summary Unified entrypoint: boots the orchestrator server when --serve is set, otherwise parses global flags and dispatches the requested subcommand handler. @param argv Command-line arguments (runtime argv: Bun.argv or process.argv); slice(2) drops node/script paths. @returns Process exit code (0 ok, 1 runtime error, 2 usage/validation error). */
export async function main(argv: string[]): Promise<number> {
  // Dual-mode entrypoint: `rolecall --serve` boots the Express orchestrator instead of
  // dispatching a CLI subcommand. Short-circuit BEFORE parseArgs (strict mode would
  // otherwise reject `--serve` as an unknown option). Loaded lazily so plain CLI
  // invocations never pay for importing the server layer.
  // Wrapped in try/catch so a Node-side failure (e.g. openStore throwing its
  // "SQLite backend is not available under the Node runtime" error) surfaces as a
  // clean one-line error instead of an unhandled rejection/stack trace.
  if (argv.slice(2).includes("--serve")) {
    try {
      const { startServe } = await import("../orchestrator");
      return await startServe(argv);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      writeErr(`error: ${msg}\n`);
      return 1;
    }
  }

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv.slice(2),
      options: GLOBAL_OPTS,
      allowPositionals: true,
      strict: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeErr(`error: ${msg}\n`);
    writeErr("run 'rolecall --help' for usage.\n");
    return 2;
  }

  const { values, positionals } = parsed;

  if (values["help"]) {
    writeOut(HELP);
    return 0;
  }
  if (values["version"]) {
    writeOut(`rolecall ${await getVersion()}\n`);
    return 0;
  }

  // Validate the output plugin name up front (clean error, no stack trace).
  const flags = buildFlags(values);
  if (!getOutputPlugin(flags.output)) {
    writeErr(
      `error: unknown output plugin '${flags.output}' ` +
        `(available: ${listOutputPlugins().join(", ")})\n`,
    );
    return 2;
  }

  // Auto-load user-registered plugins (modules + fact declarations) so `playbook run`
  // can dispatch them and `var_strict` validates their declared facts. A broken
  // plugin is skipped with a warning rather than aborting the whole invocation.
  await loadRegisteredPlugins();

  const [cmd, sub, ...rest] = positionals;

  let result: CliResult;
  try {
    switch (cmd) {
      case "playbook":
        result = await runPlaybookCommand(sub, rest, flags);
        break;
      case "facts":
        result = await runFactsCommand(sub, rest, flags);
        break;
      case "inventory":
        result = await runInventoryCommand(sub, rest, flags);
        break;
      case "plugin":
        result = await runPluginCommand(rest, flags);
        break;
      case "run":
        result = await runReplayCommand(sub, rest, flags);
        break;
      case "agent":
        result = await runAgentCommand(sub, rest, flags);
        break;
      case "docs":
        result = await runDocsCommand(sub, rest, flags);
        break;
      case "vars":
        result = await runVarsCommand(sub, rest, flags);
        break;
      case undefined:
        writeOut(HELP);
        return 0;
      default:
        writeErr(`error: unknown command '${cmd}'\n`);
        writeErr("run 'rolecall --help' for the list of subcommands.\n");
        return 2;
    }
  } catch (e) {
    if (e instanceof CliError) {
      writeErr(`error: ${e.message}\n`);
      if (e.usage) writeErr("run 'rolecall --help' for usage.\n");
      return e.usage ? 2 : 1;
    }
    const msg = e instanceof Error ? e.message : String(e);
    writeErr(`error: ${msg}\n`);
    return 1;
  }

  // syslog is the default for playbook runs (it installs the realtime per-task
  // event sink and streams one JSON line per task); every other command renders a
  // no-op terminal string under syslog, so inspection commands fall back to
  // human_summary unless the user picked an explicit output plugin.
  const PLAYBOOK_EXEC = result.command === "playbook run";
  const effectiveOutput =
    flags.output === "syslog" && !PLAYBOOK_EXEC ? "human_summary" : flags.output;
  writeOut(renderOutput(effectiveOutput, result), effectiveOutput);
  // Exit non-zero only when a playbook run had failures.
  if (result.command === "playbook run" && result.totals && result.totals.failed > 0) {
    return 1;
  }
  return 0;
}

// Only run when executed directly (e.g. `bun run src/cli/index.ts` or via the
// bin/rolecall.js shim). Importing this module for its barrel exports does NOT run main.
if (import.meta.main) {
  const argv = typeof Bun !== "undefined" ? Bun.argv : process.argv;
  const code = await main(argv);
  process.exit(code);
}
