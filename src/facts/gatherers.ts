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


/** Distribution/package-manager/service-manager facts from os-release + PATH probes. */
export const systemGatherer: FactGatherer = {
  name: "system",
  provides: ["distribution", "distribution_version", "distribution_major_version", "distribution_release", "pkg_mgr", "service_mgr"],
  connectionKinds: ["ssh", "local"],
  async gather(conn, opts) {
    let distribution: string | undefined;
    let distributionVersion: string | undefined;
    let distributionMajor: string | undefined;
    let distributionRelease: string | undefined;
    try {
      const rel = await execTrim(conn, "cat /etc/os-release", opts);
      const field = (key: string): string | undefined =>
        rel.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.replace(/^"|"$/g, "");
      distribution = field("ID");
      distributionVersion = field("VERSION_ID");
      distributionMajor = distributionVersion?.split(".")[0];
      distributionRelease = field("VERSION_CODENAME") ?? field("UBUNTU_CODENAME");
    } catch {
      /* optional */
    }
    const has = async (bin: string): Promise<boolean> =>
      (await execTrim(conn, `command -v ${bin} >/dev/null 2>&1 && echo yes || echo no`, opts)) === "yes";
    let pkgMgr: string | undefined;
    for (const [bin, name] of [["apt-get", "apt"], ["dnf", "dnf"], ["yum", "yum"], ["zypper", "zypper"], ["pacman", "pacman"], ["apk", "apk"]] as const) {
      if (await has(bin)) {
        pkgMgr = name;
        break;
      }
    }
    const serviceMgr = (await has("systemctl")) ? "systemd" : (await has("service")) ? "service" : undefined;
    return {
      distribution,
      distribution_version: distributionVersion,
      distribution_major_version: distributionMajor,
      distribution_release: distributionRelease,
      pkg_mgr: pkgMgr,
      service_mgr: serviceMgr,
    } satisfies FactMap;
  },
};

/** Default IPv4 address/interface from the route table. */
export const defaultIpv4Gatherer: FactGatherer = {
  name: "default-ipv4",
  provides: ["default_ipv4"],
  connectionKinds: ["ssh", "local"],
  async gather(conn, opts) {
    const route = await execTrim(conn, "ip -4 route get 1.1.1.1 2>/dev/null || true", opts);
    const address = route.match(/\bsrc\s+(\S+)/)?.[1];
    const iface = route.match(/\bdev\s+(\S+)/)?.[1];
    return address === undefined ? {} : { default_ipv4: { address, interface: iface } } satisfies FactMap;
  },
};

/** DNS configuration from /etc/resolv.conf. */
export const dnsGatherer: FactGatherer = {
  name: "dns",
  provides: ["dns"],
  connectionKinds: ["ssh", "local"],
  async gather(conn, opts) {
    let text = "";
    try {
      text = await execTrim(conn, "cat /etc/resolv.conf", opts);
    } catch {
      return {};
    }
    const nameservers = [...text.matchAll(/^nameserver\s+(\S+)/gm)].map((m) => m[1]!);
    const search = text.match(/^search\s+(.+)$/m)?.[1]?.trim().split(/\s+/);
    const domain = text.match(/^domain\s+(\S+)/m)?.[1];
    return { dns: { nameservers, search: search ?? [], domain } } satisfies FactMap;
  },
};

/** Date/time facts in both ISO-8601 and component form. */
export const dateTimeGatherer: FactGatherer = {
  name: "date-time",
  provides: ["date_time"],
  connectionKinds: ["ssh", "local"],
  async gather(conn, opts) {
    const iso = await execTrim(conn, "date -u +%Y-%m-%dT%H:%M:%SZ", opts);
    const epoch = await execTrim(conn, "date +%s", opts);
    const parts = await execTrim(conn, "date +%Y-%m-%d-%H-%M-%S", opts);
    const [year, month, day, hour, minute, second] = parts.split("-");
    return {
      date_time: {
        iso8601: iso,
        epoch: Number.parseInt(epoch, 10),
        year,
        month,
        day,
        hour,
        minute,
        second,
        date: `${year}-${month}-${day}`,
        time: `${hour}:${minute}:${second}`,
      },
    } satisfies FactMap;
  },
};

/** The built-in gatherer set the engine uses by default. */
export const BUILTIN_GATHERERS: readonly FactGatherer[] = [
  osGatherer,
  networkGatherer,
  systemGatherer,
  defaultIpv4Gatherer,
  dnsGatherer,
  dateTimeGatherer,
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
