// Facts module — shared types & contracts (Wave 4).
//
// A "fact" is a named piece of observed state about a target (OS, network,
// service state, ...). Gathering is TARGETED: callers request only the keys they
// need and the engine runs ONLY the gatherers that can supply those keys — never
// a full sweep. Results are cached per host+keys so repeated gathers are free.

import type { Connection } from "../transport/connection";
import type { VarManifestEntry } from "../config/var-manifest/types";

/** A fact key (e.g. "os", "kernel", "hostname", "service_status"). */
export type FactKey = string;

/** The connection transports a gatherer is valid for (mirrors `Connection.kind`). */
export type ConnectionKind = Connection["kind"];

/** A flat map of fact key -> observed value. */
export type FactMap = Record<string, unknown>;

/** Options controlling a single gather call. */
export interface GatherOptions {
  /** Explicit host id used for the cache key (else derived from the connection). */
  host?: string;
  /** Cache TTL in ms. Default 60_000. Ignored when `force` is set. */
  ttlMs?: number;
  /** Skip the cache and force a fresh gather. */
  force?: boolean;
  /** Abort signal propagated to transport calls. */
  signal?: AbortSignal;
  /**
   * When true, a gatherer failure throws a typed `FactError` instead of being
   * skipped. Default false => graceful partial result (missing keys omitted).
   */
  throwOnError?: boolean;
}

/**
 * A gatherer produces a SUBSET of facts for a connection. It declares the keys it
 * can provide so the engine can run ONLY the gatherers needed for the requested
 * key set (targeted gather — no full sweeps).
 */
export interface FactGatherer {
  /** Stable id, e.g. "os", "network", "service". */
  readonly name: string;
  /** Fact keys this gatherer can produce. */
  readonly provides: readonly FactKey[];
  /**
   * Connection transports this gatherer is valid for. Omit to apply to every kind
   * (the engine filters candidates by `connection.kind` at gather time, so a host
   * only runs gatherers that suit its transport — Ansible-aligned).
   */
  readonly connectionKinds?: readonly ConnectionKind[];
  /** Gather the facts this gatherer owns. May throw on transport failure. */
  gather(connection: Connection, opts?: GatherOptions): Promise<FactMap>;
}

/**
 * User-extensible fact plugin: bundles one or more gatherers under a name so
 * users can add custom fact sources without touching the engine. Optionally
 * declares the fact schemas it owns (`declares`) so `$var: facts.*` references to them
 * validate under `var_strict`.
 */
export interface FactPlugin {
  readonly name: string;
  readonly gatherers: readonly FactGatherer[];
  /** Typed fact schemas this plugin can produce; merged into the declared-fact registry. */
  readonly declares?: readonly VarManifestEntry[];
}

/** Typed error for fact-gathering failures the caller can catch. */
export class FactError extends Error {
  constructor(
    message: string,
    readonly host: string,
    readonly gatherer: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "FactError";
  }
}
