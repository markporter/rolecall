// Runtime configuration layer for RoleCall.
//
// loadConfig() reads the small set of environment variables that select RoleCall's
// behavior (database backend, project/git source, scratch storage, orchestrator
// bind settings) and merges them over safe built-in defaults. It deliberately
// adds NO dotenv dependency: Bun auto-loads `.env` / `.env.*` into process.env,
// so reading process.env here covers both real env vars and any .env file.
//
// Every field carries a safe default so callers never see undefined where a
// concrete value is expected. Unset variables leave behavior identical to prior
// ad-hoc reads — this is internal plumbing selected purely by env vars. See
// .omo/notepads/vfs-db-abstractions/learnings.md for the inherited constraints.

import { join } from "node:path";
import { tmpdir } from "node:os";
import { readEnvFile } from "../install/env-file";
import { resolveInstallLayout } from "../install/layout";

/** Scratch-storage strategy resolved by loadConfig(). */
export type ScratchStrategy = "fs" | "memory";
/** Supported database backends. Only "sqlite" is wired today; "postgres" throws until its backend lands. */
export type DbBackend = "sqlite" | "postgres";

/** Settings controlling how `rolecall --serve` binds its HTTP listener. Numeric/host fields stay optional so each caller keeps its own fallback default. */
export interface ServeConfig {
  /** Listen port (ROLECALL_SERVE_PORT). Undefined => caller applies its numeric default (8080). */
  port?: number;
  /** Listen host (ROLECALL_SERVE_HOST). Undefined => caller applies its string default ("127.0.0.1"). */
  host?: string;
  /** Static UI directory to serve (ROLECALL_UI_DIST, plus legacy ROLECALL_SERVE_UI_DIST fallback). Undefined => zero-build mode. */
  uiDist?: string;
}

/** Merged, typed runtime configuration derived from the environment + safe defaults. */
export interface Config {
  /** Database backend selector. Default "sqlite". "postgres" is recorded only; wiring is deferred. */
  dbBackend: DbBackend;
  /** Optional direct database URL (ROLECALL_DB_URL). Empty string normalizes to undefined. */
  dbUrl?: string;
  /** Optional git URL for a remote project source (ROLECALL_PROJECT_GIT_URL). Empty string normalizes to undefined. */
  projectGitUrl?: string;
  /** Scratch-storage strategy. Default "fs". */
  scratch: ScratchStrategy;
  /** Directory backing fs scratch. Defaults to os.tmpdir(); empty/unset ROLECALL_SCRATCH_DIR falls back there too. */
  scratchDir: string;
  /** Orchestrator bind settings. */
  serve: ServeConfig;
  /** ROLECALL_HOME override (~/.rolecall global home root when unset). */
  home?: string;
  /** ROLECALL_PROJECT_STATE override for the state-root precedence chain. */
  projectState?: string;
  /** ROLECALL_RUNTIME override consumed by detectRuntime(). */
  runtime?: string;
}

/** Coerce an env var to a valid DbBackend; anything other than exactly "postgres" defaults to sqlite. */
function parseDbBackend(raw: string | undefined): DbBackend {
  return raw === "postgres" ? "postgres" : "sqlite";
}

/** Coerce an env var to a valid ScratchStrategy; anything other than exactly "memory" defaults to fs. */
function parseScratch(raw: string | undefined): ScratchStrategy {
  return raw === "memory" ? "memory" : "fs";
}

/** Parse an int-valued env var; returns undefined unless the trimmed value is non-empty and finite. */
function parseIntEnv(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Normalize an optional string env var: empty strings become undefined so downstream sees "unset". */
function strOrUndef(raw: string | undefined): string | undefined {
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

/** Resolve the scratch directory: empty or unset ROLECALL_SCRATCH_DIR falls back to os.tmpdir() without throwing. */
function resolveScratchDir(raw: string | undefined): string {
  return typeof raw === "string" && raw.length > 0 ? raw : tmpdir();
}

/** Options for loadConfig; file paths/env are injectable for tests and server child processes. */
export interface LoadConfigOptions {
  /** Project root for `<project>/.rolecall/rolecall.env` (defaults to cwd). */
  projectRoot?: string;
  /** Override system/user/project env-file paths (tests). */
  systemEnvFile?: string;
  userEnvFile?: string;
  projectEnvFile?: string;
  /** Environment overrides merged last (defaults to process.env). */
  env?: Record<string, string | undefined>;
}

/** Resolve the system/user/project env files for the current install layout. */
function envFiles(options: LoadConfigOptions): string[] {
  const processEnv = process.env as Record<string, string | undefined>;
  if (options.systemEnvFile || options.userEnvFile || options.projectEnvFile) {
    return [options.systemEnvFile, options.userEnvFile, options.projectEnvFile].filter(
      (p): p is string => typeof p === "string" && p.length > 0,
    );
  }
  const platform = process.platform;
  const system = resolveInstallLayout({ scope: "system", platform, env: processEnv }).envFile;
  const user = resolveInstallLayout({ scope: "user", platform, env: processEnv }).envFile;
  const project = join(options.projectRoot ?? process.cwd(), ".rolecall", "rolecall.env");
  return [...new Set([system, user, project])];
}

/**
 * Read RoleCall's environment variables and merge them over safe built-in defaults.
 *
 * Precedence (low → high): system `rolecall.env` → user `rolecall.env` →
 * project `.rolecall/rolecall.env` → process environment. Missing files are
 * ignored; process environment always wins.
 * @returns A fully-typed Config in which every scalar field resolves without undefined even when all vars are unset.
 */
export function loadConfig(options: LoadConfigOptions = {}): Config {
  const base = options.env ?? (process.env as Record<string, string | undefined>);
  const merged: Record<string, string | undefined> = {};
  for (const file of envFiles(options)) Object.assign(merged, readEnvFile(file));
  Object.assign(merged, base);
  return {
    dbBackend: parseDbBackend(merged["ROLECALL_DB_BACKEND"]),
    dbUrl: strOrUndef(merged["ROLECALL_DB_URL"]),
    projectGitUrl: strOrUndef(merged["ROLECALL_PROJECT_GIT_URL"]),
    scratch: parseScratch(merged["ROLECALL_SCRATCH"]),
    scratchDir: resolveScratchDir(merged["ROLECALL_SCRATCH_DIR"]),
    serve: {
      port: parseIntEnv(merged["ROLECALL_SERVE_PORT"]),
      host: merged["ROLECALL_SERVE_HOST"],
      // Preserve existing behavior (ROLECALL_UI_DIST takes priority) while also honoring the plan-named ROLECALL_SERVE_UI_DIST as a secondary.
      uiDist: merged["ROLECALL_UI_DIST"] ?? merged["ROLECALL_SERVE_UI_DIST"],
    },
    home: merged["ROLECALL_HOME"],
    projectState: merged["ROLECALL_PROJECT_STATE"],
    runtime: merged["ROLECALL_RUNTIME"],
  };
}
