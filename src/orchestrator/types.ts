// Orchestrator public data model (Task 18 — dual-mode entrypoint / Express API).
//
// These shapes are shared between the CLI (`rolecall --serve`) boot path and the HTTP
// routes. They deliberately reuse upstream models where possible: job bodies map
// onto the config schema (playbook/inventory), run records mirror the store's Run
// row, and targets describe reachable simulated/real endpoints consumed by the
// transport clients (src/transport).

import type {
  NormalizedInventory,
  NormalizedPlaybook,
  NormalizedPlaybookFile,
} from "../config/schema";
import type { Credentials, RetryConfig } from "../transport/connection";
import type { NetworkDeviceSimHandle } from "../testing/sims/network-device";
import type { Store } from "../store";

/** Lifecycle of an orchestrator run as observed via GET /runs/:id/status. */
export type RunStatus = "queued" | "running" | "success" | "failed";

/** Job kinds accepted by POST /run. */
export type ActionType = "playbook" | "adhoc" | "nonIdempotent";

/** Transport kind for a fleet target — selects the client used to reach it. */
export type TransportKind = "ssh" | "local" | "http" | "network";

/** A registered, reachable target (simulated via Task-17 factories or real). */
export interface TargetDescriptor {
  name: string;
  kind: TransportKind;
  // --- ssh / local connection fields (subset of ConnectionOptions) ---
  host?: string;
  port?: number;
  user?: string;
  credentials?: Credentials;
  // SSH/network clients expect a filesystem path (not a flag). We pass strictHostKeyChecking:false in engine, so this is informational.
  knownHostsPath?: string;
  shell?: string;
  timeoutMs?: number;
  retry?: Partial<RetryConfig>;
  // --- http endpoint ---
  url?: string;
  auth?: { type: "basic" | "token"; user?: string; pass?: string; token?: string };
  // --- network device simulator handle (programmatic apply/diff surface) ---
  device?: NetworkDeviceSimHandle;
}

/** One task execution emitted by a playbook plan. */
export interface PlanTask {
  name: string;
  module: string;
  args?: Record<string, unknown>;
}

/** Body of POST /run. Enough to resolve targets + execute against sims. */
export interface JobBody {
  type: ActionType;
  /** Explicit target names/patterns over the fleet (default: all). */
  targets?: string[];
  /** Target patterns when resolving through an inventory. */
  hosts?: string[];
  limit?: string;
  /** Ad-hoc module name (e.g. "ping", "command"). */
  module?: string;
  /** Inline playbook tasks (alternative to playbook/playbookPath). */
  tasks?: PlanTask[];
  /** Inline normalized playbook (alternative to playbook/playbookPath): one play or a list of plays. */
  playbook?: NormalizedPlaybookFile;
  /** Inline parsed inventory (alternative to inventory/inventoryPath). */
  inventory?: NormalizedInventory;
  /** Desired state pushed by set_config-style modules (esp. network). */
  config?: string;
  /** Generic module arguments forwarded per-target. */
  args?: Record<string, unknown>;
  /** Fire-and-forget: always apply even if already in desired state. */
  force?: boolean;
  /** Load playbook from this YAML file path (reuses src/config loaders verbatim). */
  playbookPath?: string;
  /** Load inventory from this YAML file path (reuses src/config loaders verbatim). */
  inventoryPath?: string;
}

/** Per-host result of executing one action against one target. */
export interface HostOutcome {
  host: string;
  ok: boolean;
  changed: boolean;
  summary: string;
  detail?: unknown;
}

/** Durable-ish run record kept in-memory keyed by runId (+ persisted to store). */
export interface RunRecord {
  id: string;
  jobType: ActionType;
  status: RunStatus;
  startedAt: number;
  finishedAt?: number;
  outcomes: HostOutcome[];
  error?: string;
  dispatchCount: number;
}

/** Minimal scheduler hook invoked by schedule-management endpoints. */
export interface SchedulerApi {
  /** Trigger a scheduled job now; returns true if dispatched. */
  trigger(params: Record<string, unknown>): Promise<boolean>;
}

/** Stable JSON envelope returned by every run-trigger endpoint on success. */
export interface TriggerSuccess {
  runId: string;
  status: "queued";
  type: ActionType;
  self: string;
}

/** Options accepted by createServer(). */
export interface ServerOptions {
  port?: number;
  hostname?: string;
  /** Durable registry (Task 19 store). Opened internally when omitted. */
  store?: Store;
  /** Initial fleet targets. Register more via an admin endpoint later. */
  fleet?: TargetDescriptor[];
  scheduler?: SchedulerApi;
  tickMs?: number;
  /** Disable signal-handler installation (used by tests that close manually). Default false. */
  noSignalHandlers?: boolean;
  // TODO(ROLECALL-PLACEHOLDER): authToken is a placeholder only — RBAC/multi-user deferred
  /** Optional single-token Bearer guard for run-trigger endpoints (webhook/REST). When set, requests must send `Authorization: Bearer <token>` else 401. Placeholder ONLY — RBAC/multi-user is deferred. Unset => open. */
  authToken?: string;
  /** Directory whose contents are served as a pluggable static UI (Todo 23). UNSET => zero-build mode (GET "/" stays health JSON). SET + exists => express.static(dir); SET + missing => deterministic plain-text guidance. */
  uiDist?: string;
}
