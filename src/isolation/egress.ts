// Destination whitelist policy for ADR 0025.
//
// This is the module-facing half of egress control: `--allow-egress host:port`
// rules are checked before http/get_url/git dispatch. The CONNECT/SOCKS broker
// for untrusted shell commands is a separate layer; this policy is what both
// layers will share.

import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

export type EgressProtocol = "tcp";
export type EgressScope = "shell" | "module" | "all";

export interface EgressRule {
  /** Hostname, IP, or IPv4 CIDR. */
  host: string;
  /** Allowed ports; omitted means any port. */
  ports?: number[];
  protocol?: EgressProtocol;
  scope?: EgressScope;
}

export interface EgressDecision {
  allowed: boolean;
  reason: string;
  host: string;
  port: number;
  addresses?: string[];
  rule?: EgressRule;
}

export interface EgressPolicyOptions {
  /** DNS resolver override (tests); defaults to dns.lookup all addresses. */
  resolver?: (host: string) => Promise<string[]>;
}

const PRIVATE_CIDRS: Array<[string, number, number]> = [
  ["0.0.0.0", 8, 0],
  ["10.0.0.0", 8, 0],
  ["100.64.0.0", 10, 0],
  ["127.0.0.0", 8, 0],
  ["169.254.0.0", 16, 0],
  ["172.16.0.0", 12, 0],
  ["192.168.0.0", 16, 0],
].map(([net, bits]) => [String(net), Number(bits), 0]);

function ipv4ToInt(ip: string): number | undefined {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return undefined;
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

function inCidr(ip: string, cidr: string): boolean {
  const slash = cidr.indexOf("/");
  if (slash < 0) return false;
  const base = cidr.slice(0, slash);
  const bits = Number(cidr.slice(slash + 1));
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt === undefined || baseInt === undefined || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80:");
  }
  return PRIVATE_CIDRS.some(([net, bits]) => inCidr(ip, `${net}/${bits}`));
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
}

function ruleMatchesHost(rule: EgressRule, host: string): boolean {
  const r = normalizeHost(rule.host);
  const h = normalizeHost(host);
  if (r === h) return true;
  if (r.includes("/")) return isIP(h) !== 0 && inCidr(h, r);
  return false;
}

function ruleMatchesPort(rule: EgressRule, port: number): boolean {
  return !rule.ports || rule.ports.length === 0 || rule.ports.includes(port);
}

function ruleScopeMatches(rule: EgressRule, scope: EgressScope): boolean {
  const s = rule.scope ?? "shell";
  return s === "all" || s === scope;
}

/** Parse repeatable `--allow-egress host[:port]` specs. */
export function parseEgressSpecs(specs: string[] | undefined): EgressRule[] {
  return (specs ?? []).map((raw) => {
    const spec = raw.trim();
    if (!spec) throw new Error("--allow-egress cannot be empty");
    let host = spec;
    let port: number | undefined;
    const bracket = spec.match(/^\[([^\]]+)\](?::(\d+))?$/);
    if (bracket) {
      host = bracket[1]!;
      port = bracket[2] ? Number(bracket[2]) : undefined;
    } else {
      const idx = spec.lastIndexOf(":");
      if (idx > 0 && /^\d+$/.test(spec.slice(idx + 1))) {
        host = spec.slice(0, idx);
        port = Number(spec.slice(idx + 1));
      }
    }
    if (!host) throw new Error(`invalid --allow-egress '${raw}'`);
    if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      throw new Error(`invalid --allow-egress port in '${raw}'`);
    }
    return {
      host,
      ...(port !== undefined ? { ports: [port] } : {}),
      protocol: "tcp",
      scope: "all",
    };
  });
}

/** Destination policy shared by module checks and (later) the shell broker. */
export class EgressPolicy {
  readonly #rules: EgressRule[];
  readonly #resolver: (host: string) => Promise<string[]>;

  constructor(rules: EgressRule[], options: EgressPolicyOptions = {}) {
    this.#rules = rules.map((r) => ({ ...r, host: normalizeHost(r.host), scope: r.scope ?? "shell" }));
    this.#resolver =
      options.resolver ??
      (async (host: string) => (await lookup(host, { all: true })).map((a) => a.address));
  }

  get rules(): readonly EgressRule[] {
    return this.#rules;
  }

  /** Synchronous exact host/IP/CIDR check (no DNS). */
  allows(host: string, port: number, scope: EgressScope = "module"): boolean {
    return this.#rules.some(
      (r) => ruleScopeMatches(r, scope) && ruleMatchesPort(r, port) && ruleMatchesHost(r, host),
    );
  }

  /**
   * Resolve the target once and validate every address. A hostname rule allows
   * public addresses; private/loopback/CIDR addresses require an explicit
   * IP/CIDR rule. Any disallowed address denies the whole target (fail closed).
   */
  async checkTarget(host: string, port: number, scope: EgressScope = "module"): Promise<EgressDecision> {
    const normalized = normalizeHost(host);
    const hostRule = this.#rules.find(
      (r) => ruleScopeMatches(r, scope) && ruleMatchesPort(r, port) && !r.host.includes("/") && r.host === normalized,
    );
    let addresses: string[];
    if (isIP(normalized) !== 0) {
      addresses = [normalized];
    } else {
      try {
        addresses = await this.#resolver(normalized);
      } catch (err) {
        return {
          allowed: false,
          host: normalized,
          port,
          reason: `DNS resolution failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
    if (addresses.length === 0) {
      return { allowed: false, host: normalized, port, reason: "no addresses resolved" };
    }

    for (const address of addresses) {
      const explicit = this.#rules.find(
        (r) => ruleScopeMatches(r, scope) && ruleMatchesPort(r, port) && ruleMatchesHost(r, address),
      );
      if (explicit) continue;
      if (hostRule && !isPrivateIp(address)) continue;
      return {
        allowed: false,
        host: normalized,
        port,
        addresses,
        reason: hostRule
          ? `resolved address ${address} is private and has no explicit IP/CIDR rule`
          : `destination ${normalized}:${port} is not allow-listed`,
      };
    }
    return {
      allowed: true,
      host: normalized,
      port,
      addresses,
      ...(hostRule ? { rule: hostRule } : {}),
      reason: "destination allow-listed",
    };
  }

  /** Check an http(s) URL before a module dispatches it. */
  async checkUrl(rawUrl: string, scope: EgressScope = "module"): Promise<EgressDecision> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return { allowed: false, host: rawUrl, port: 0, reason: `invalid URL '${rawUrl}'` };
    }
    const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
    return this.checkTarget(url.hostname, port, scope);
  }
}
