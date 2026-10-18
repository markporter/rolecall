// Built-in fact gatherers + a sample FactPlugin (Wave 4).
//
// Each gatherer declares the keys it PROVIDES so the engine can run only the
// gatherers needed for a targeted request. Gatherers are transport-agnostic: they
// call `connection.exec` / `connection.health` and parse the output. A gatherer
// that throws (unreachable host, parse miss) is caught by the engine — the failed
// keys are simply omitted from the result (graceful partial).

import type { Connection } from "../transport/connection";
import type { FactGatherer, FactMap, FactPlugin, GatherOptions } from "./types";

async function execTrim(conn: Connection, cmd: string, opts?: GatherOptions): Promise<string> {
  const r = await conn.exec(cmd, { signal: opts?.signal });
  return r.stdout.trim();
}

/** OS / kernel / distro facts via `uname` + /etc/os-release (shelled hosts only). */
export const osGatherer: FactGatherer = {
  name: "os",
  provides: ["os", "kernel", "arch", "os_family"],
  connectionKinds: ["ssh", "local"],
  async gather(conn, opts) {
    const uname = await execTrim(conn, "uname -srm", opts);
    const [os, kernel, arch] = uname.split(/\s+/);
    let osFamily: string | undefined;
    try {
      const rel = await execTrim(conn, "cat /etc/os-release", opts);
      const m = rel.match(/^ID=(.+)$/m);
      osFamily = m?.[1]?.replace(/^"|"$/g, "");
    } catch {
      /* os-release optional */
    }
    return { os, kernel, arch, os_family: osFamily } satisfies FactMap;
  },
};

/** Network identity facts via `hostname` / `hostname -I` (shelled hosts only). */
export const networkGatherer: FactGatherer = {
  name: "network",
  provides: ["hostname", "ip_addresses"],
  connectionKinds: ["ssh", "local"],
  async gather(conn, opts) {
    const hostname = await execTrim(conn, "hostname", opts);
    const ipAddresses = (await execTrim(conn, "hostname -I", opts))
      .split(/\s+/)
      .filter(Boolean);
    return { hostname, ip_addresses: ipAddresses } satisfies FactMap;
  },
};

/** Service / state facts for shelled hosts (SSH/local): probe `systemctl is-active ssh`. */
export const serviceGathererPosix: FactGatherer = {
  name: "service-posix",
  provides: ["service_status"],
  connectionKinds: ["ssh", "local"],
  async gather(conn, opts) {
    const state = await execTrim(conn, "systemctl is-active ssh", opts);
    return { service_status: state || "unknown" } satisfies FactMap;
  },
};

/** Service / state facts for HTTP targets: probe API liveness via `connection.health()`. */
export const serviceGathererHttp: FactGatherer = {
  name: "service-http",
  provides: ["service_status"],
  connectionKinds: ["http"],
  async gather(conn, opts) {
    const h = await conn.health();
    return { service_status: h.ok ? "running" : "down" } satisfies FactMap;
  },
};

/** The built-in gatherer set the engine uses by default. */
export const BUILTIN_GATHERERS: readonly FactGatherer[] = [
  osGatherer,
  networkGatherer,
  serviceGathererPosix,
  serviceGathererHttp,
];

/**
 * Helper to build a user FactPlugin from one or more gatherers. Users add custom
 * fact sources without touching the engine:
 *
 *   const plugin = createFactPlugin("myfacts", [{
 *     name: "tz", provides: ["timezone"],
 *     gather: async (c) => ({ timezone: (await c.exec("cat /etc/timezone")).stdout.trim() }),
 *   }]);
 *   engine.registerPlugin(plugin);
 */
export function createFactPlugin(
  name: string,
  gatherers: readonly FactGatherer[],
): FactPlugin {
  return { name, gatherers };
}
