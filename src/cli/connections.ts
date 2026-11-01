// Shared connection factory for the CLI surface.
//
// Builds a transport `Connection` for a resolved inventory host by reading
// RoleCall-style `rolecall_*` host vars. Honors `rolecall_connection`
// (ssh | local | network | network_sim | http; default ssh) and maps the
// corresponding `rolecall_*` vars.
//
// Both `playbook run` and `facts gather` route through this so connection
// construction stays in exactly one place. `network_sim` targets the in-process
// network-device simulator's HTTP bridge; `http` builds an HttpApiConnection from
// `rolecall_http_url` (used by the serve orchestrator's forked playbook runs).

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { LocalConnection } from "../transport/local";
import { NetworkSshConnection } from "../transport/network";
import { SshConnection } from "../transport/ssh";
import { HttpApiConnection } from "../transport/http";
import { SimNetworkConnection } from "../transport/sim-network";
import type { Connection, Credentials, HttpAuth } from "../transport/connection";

const NO_RETRY = { retries: 0, minTimeout: 10, maxTimeout: 50, factor: 2, randomize: false };
const CONNECT_TIMEOUT_MS = 8000;

/** Per-host vars the factory consults (RoleCall-compatible subset). */
export interface HostConnectionVars {
  rolecall_connection?: unknown;
  rolecall_host?: unknown;
  rolecall_user?: unknown;
  rolecall_port?: unknown;
  rolecall_ssh_user?: unknown;
  rolecall_ssh_port?: unknown;
  rolecall_ssh_private_key_file?: unknown;
  /** Inline PEM private key (used by the serve orchestrator's temp inventories). */
  rolecall_ssh_private_key?: unknown;
  rolecall_ssh_pass?: unknown;
  rolecall_password?: unknown;
  /** HTTP target URL (rolecall_connection: http). */
  rolecall_http_url?: unknown;
  rolecall_http_user?: unknown;
  rolecall_http_pass?: unknown;
  rolecall_http_token?: unknown;
  /** Network simulator base URL (rolecall_connection: network_sim). */
  rolecall_sim_url?: unknown;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function asPort(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function resolveCredentials(vars: Record<string, unknown>): Credentials | undefined {
  const keyFile = asString(vars["rolecall_ssh_private_key_file"]);
  const inlineKey = asString(vars["rolecall_ssh_private_key"]);
  let privateKey: string | undefined = inlineKey;
  if (!privateKey && keyFile) {
    const expanded = keyFile.startsWith("~") ? join(homedir(), keyFile.slice(1)) : keyFile;
    if (existsSync(expanded)) privateKey = readFileSync(expanded, "utf-8");
  }
  const password = asString(vars["rolecall_ssh_pass"]) ?? asString(vars["rolecall_password"]);
  if (!privateKey && !password) return undefined;
  return { ...(privateKey ? { privateKey } : {}), ...(password ? { password } : {}) };
}

/**
 * @summary Build a transport Connection for a resolved inventory host from its
 * `rolecall_*` vars. Honors `rolecall_connection` (ssh | local | network; default
 * ssh) and maps host/user/port/credentials from the matching `rolecall_*` keys.
 * @param host The resolved inventory host name (used as the connection target
 *   unless `rolecall_host` overrides it).
 * @param vars Per-host resolved vars.
 * @returns A Connection ready for `connect()` / `exec()`.
 */
export function buildConnectionForHost(
  host: string,
  vars: Record<string, unknown>,
): Connection {
  const kind = (asString(vars["rolecall_connection"]) ?? "ssh").toLowerCase();
  const targetHost = asString(vars["rolecall_host"]) ?? host;
  const user =
    asString(vars["rolecall_user"]) ??
    asString(vars["rolecall_ssh_user"]) ??
    process.env["USER"] ??
    process.env["USERNAME"] ??
    "root";
  const port = asPort(vars["rolecall_port"] ?? vars["rolecall_ssh_port"], 22);

  switch (kind) {
    case "local":
      return new LocalConnection({
        kind: "local",
        host: targetHost,
        user,
        timeoutMs: CONNECT_TIMEOUT_MS,
        retry: NO_RETRY,
      });
    case "network":
      return new NetworkSshConnection({
        kind: "network",
        host: targetHost,
        port,
        user,
        credentials: resolveCredentials(vars),
        strictHostKeyChecking: false,
        timeoutMs: CONNECT_TIMEOUT_MS,
        retry: NO_RETRY,
      });
    case "network_sim": {
      const url = asString(vars["rolecall_sim_url"]);
      if (!url) throw new Error("buildConnectionForHost: network_sim requires 'rolecall_sim_url'");
      return new SimNetworkConnection({ url, host: targetHost, user, timeoutMs: CONNECT_TIMEOUT_MS });
    }
    case "http": {
      const raw = asString(vars["rolecall_http_url"]);
      if (!raw) throw new Error("buildConnectionForHost: http requires 'rolecall_http_url'");
      const parsed = new URL(raw);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(`buildConnectionForHost: only http(s) URLs are supported (got ${parsed.protocol})`);
      }
      const httpUser = asString(vars["rolecall_http_user"]);
      const httpPass = asString(vars["rolecall_http_pass"]);
      const token = asString(vars["rolecall_http_token"]);
      const auth: HttpAuth | undefined = token
        ? { type: "token", token }
        : httpUser !== undefined || httpPass !== undefined
          ? { type: "basic", user: httpUser ?? user, pass: httpPass ?? "" }
          : undefined;
      return new HttpApiConnection({
        kind: "http",
        protocol: parsed.protocol === "https:" ? "https" : "http",
        host: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : (parsed.protocol === "https:" ? 443 : 80),
        user: httpUser ?? user,
        basePath: parsed.pathname.replace(/\/$/, ""),
        request: { method: "GET", path: "/" },
        healthPath: "/ping",
        ...(auth ? { auth } : {}),
        timeoutMs: CONNECT_TIMEOUT_MS,
        retry: NO_RETRY,
      });
    }
    case "ssh":
      return new SshConnection({
        kind: "ssh",
        host: targetHost,
        port,
        user,
        credentials: resolveCredentials(vars),
        strictHostKeyChecking: false,
        timeoutMs: CONNECT_TIMEOUT_MS,
        retry: NO_RETRY,
      });
    default:
      throw new Error(
        `buildConnectionForHost: unsupported rolecall_connection '${kind}' (expected ssh | local | network)`,
      );
  }
}
