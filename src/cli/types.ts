// Shared CLI types + error class (Wave 1, Todo 5).
//
// `GlobalFlags` are parsed ONCE at the top level (src/cli/index.ts) and injected
// downward into every subcommand handler. `CliResult` is the structured payload
// each handler returns; the selected output plugin (src/cli/output.ts) renders it.
// `CliError` carries a `usage` flag so the dispatcher can pick the right exit code
// (2 = usage error, 1 = runtime error) without leaking a stack trace.

import type { DocHit } from "../docs/search";
import type { VarManifestEntry } from "../config/var-manifest/types";
import type { VarResolution } from "../config/var-trace";
import type { ConnectionKind } from "../facts/types";

// ---------------------------------------------------------------------------
// Global flags — parsed once, injected downward.
// ---------------------------------------------------------------------------
export interface GlobalFlags {
  /** Target pattern restricting hosts (single pattern; RoleCall-style). */
  limit?: string;
  /** Accepted flag; documented as compute-only (executor pending, Todo 12). */
  force: boolean;
  /** Accepted flag; documented as compute-only (executor pending, Todo 12). */
  check: boolean;
  /** Accepted flag; documented as compute-only (executor pending, Todo 12). */
  diff: boolean;
  /** Concurrency fan-out (--forks N). Parsed to a number by the dispatcher. */
  forks?: number;
  /** Selected output plugin name (default "syslog"). */
  output: string;
  /** Optional inventory source for playbook run (resolves target patterns). */
  inventory?: string;
  /** Emit + persist an execution-trace ledger for the run (Todo 25). */
  trace: boolean;
  /** Print a per-host/per-task performance profile at the end of the run (Todo 25). */
  profile: boolean;
  /** Resume a prior run from a checkpoint: `<run_id>:<checkpoint>` (Todo 26). */
  resume?: string;
  /** Raw `--extra-vars` string (`key=value` pairs); parsed into a var map by the playbook command. */
  extraVars?: string;
  /** Raw `--tags` string (comma-separated tag list); parsed into a filter by the playbook command. */
  tags?: string;
  /** Raw `--skip-tags` string (comma-separated tag list); parsed into a filter by the playbook command. */
  skipTags?: string;
}

// ---------------------------------------------------------------------------
// Structured command results (rendered by the output-plugin registry).
// ---------------------------------------------------------------------------
export interface TaskApplyOutcome {
  host: string;
  task: string;
  module: string;
  changed: boolean;
  failed: boolean;
  skipped: boolean;
  iterations?: number;
  /** Per-iteration module `data` (e.g. `{ idempotent: true }` for no-op applies); surface for idempotency visibility without a new status. */
  iterationData?: Array<Record<string, unknown> | undefined>;
  msg?: string;
}

export interface RenderedTemplate {
  task: string;
  host: string;
  engine: "eta" | "jinja";
  source: string;
  rendered: string;
}

export interface ApplyTotals {
  ok: number;
  changed: number;
  failed: number;
  skipped: number;
}

export interface PlaybookRunResult {
  command: "playbook run";
  playbook: string;
  inventory?: string;
  mode: "applied" | "dry-run";
  flags: { limit?: string; force: boolean; check: boolean; diff: boolean; forks?: number; tags?: string[]; skipTags?: string[] };
  resolvedHosts: string[];
  tasks: { name: string; module: string }[];
  skeleton: { host: string; task: string; module: string }[];
  totals?: ApplyTotals;
  outcomes?: TaskApplyOutcome[];
  rendered?: RenderedTemplate[];
  check?: boolean;
  force?: boolean;
  note: string;
}

export interface FactsGatherResult {
  command: "facts gather";
  inventory: string;
  limit?: string;
  resolvedHosts: string[];
  facts: Record<string, Record<string, unknown>>;
  failures: Record<string, string>;
  note: string;
}

export interface InventoryShowResult {
  command: "inventory show";
  inventory: string;
  matchedHosts: string[];
  hosts: Record<string, Record<string, unknown>>;
}

export interface InventoryListResult {
  command: "inventory list";
  inventory: string;
  groups: string[];
}

/** @summary One row in `plugin list` — a registered module/fact plugin or a built-in inventory plugin. */
export interface PluginEntryView {
  name: string;
  type: "module" | "fact" | "inventory";
  source: "plugin" | "inventory";
  path?: string;
}

export interface PluginListResult {
  command: "plugin list";
  plugins: PluginEntryView[];
  note: string;
}

export interface PluginRegisterResult {
  command: "plugin register";
  name: string;
  type: "module" | "fact";
  path: string;
  registered: true;
  note: string;
}

/** Result of replaying a stored run's execution-trace ledger (Todo 25). */
export interface RunReplayResult {
  command: "run replay";
  runId: string;
  found: boolean;
  traces: import("../store/types").RunTrace[];
  /** Per-host wall-clock aggregation (sum of end-trace duration_ms). */
  profile: Record<string, { tasks: number; totalMs: number; failed: number }>;
  note?: string;
}

export interface AgentManifestResult {
  command: "agent manifest";
  manifest: import("../orchestrator/mcp").McpManifest;
}

/** Result of searching RoleCall's prose documentation (`rolecall docs search`). Hits reuse {@link DocHit}. */
export interface DocsSearchResult {
  command: "docs search";
  /** The query term echoed back (trimmed). */
  query: string;
  /** Number of hits actually returned. */
  count: number;
  /** Ordered hits; most-matching-first, then line ascending. */
  hits: DocHit[];
}

/** @summary A single module entry in the `rolecall docs modules` listing. Mirrors {@link ModuleSummary}. */
export interface DocsModuleEntry {
  name: string;
  description: string;
  idempotent?: boolean;
  source?: string;
  args?: Record<string, { type: string; required: boolean; description: string }>;
  examples?: string[];
}

/** Result of listing RoleCall modules (`rolecall docs modules`). @summary Result payload for the `docs modules` subcommand, surfacing every registered module's name, description, and args (from the runtime `meta`). */
export interface DocsModulesResult {
  command: "docs modules";
  /** The filter term echoed back (empty string when listing all modules). */
  query: string;
  /** Number of modules actually returned (after any filter). */
  count: number;
  /** Ordered module summaries (sorted by name for deterministic output). */
  modules: DocsModuleEntry[];
}

/** @summary Result of `vars list`: every declared var/fact grouped by its declaring file, plus the observable-fact capability set. */
export interface VarsListResult {
  command: "vars list";
  /** Declared vars/facts grouped by the file that declared them. */
  declared: Array<{ file: string; entries: VarManifestEntry[] }>;
  /** Observable fact keys available per connection kind (built-in + registered plugins). */
  factsByKind: Record<ConnectionKind, string[]>;
}

/** @summary Result of `vars trace`: the Splunk-btool-style precedence/override view (winning value + file/layer + chain) per host. */
export interface VarsTraceResult {
  command: "vars trace";
  /** Per-play resolution: each host maps to var name → resolution (winning value + override chain). */
  plays: Array<{ name?: string; hosts: Record<string, Record<string, VarResolution>> }>;
}

export type CliResult =
  | PlaybookRunResult
  | FactsGatherResult
  | InventoryShowResult
  | InventoryListResult
  | PluginListResult
  | PluginRegisterResult
  | RunReplayResult
  | AgentManifestResult
  | DocsSearchResult
  | DocsModulesResult
  | VarsListResult
  | VarsTraceResult;

// ---------------------------------------------------------------------------
// Error class — `usage: true` => exit code 2 (unknown subcommand / bad args);
// `usage: false` => exit code 1 (runtime failure: file not found, parse error).
// ---------------------------------------------------------------------------
export class CliError extends Error {
  constructor(
    public readonly usage: boolean,
    message: string,
  ) {
    super(message);
    this.name = "CliError";
  }
}
