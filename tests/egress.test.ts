// ADR 0025 destination whitelist: parsing, DNS/IP validation, and module checks.

import { afterEach, expect, test } from "bun:test";
import { EgressPolicy, parseEgressSpecs } from "../src/isolation/egress";
import { registerAllModules } from "../src/modules/builtins";
import { registerModule, runPlaybook } from "../src/executor";
import { createNoopConnection } from "../src/executor/context";
import type { NormalizedInventory, NormalizedPlaybook } from "../src/config/schema";

const servers: Array<{ stop: () => void }> = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.stop();
});

function resolver(map: Record<string, string[]>): (host: string) => Promise<string[]> {
  return async (host) => map[host] ?? [];
}

test("parseEgressSpecs supports host:port, CIDR, and bare host", () => {
  expect(parseEgressSpecs(["api.example.com:443", "10.0.0.0/8:22", "example.com"])).toEqual([
    { host: "api.example.com", ports: [443], protocol: "tcp", scope: "all" },
    { host: "10.0.0.0/8", ports: [22], protocol: "tcp", scope: "all" },
    { host: "example.com", protocol: "tcp", scope: "all" },
  ]);
  expect(() => parseEgressSpecs(["host:99999"])).toThrow(/port/);
});

test("policy allows exact hosts, CIDRs, ports, and scopes", () => {
  const p = new EgressPolicy(
    [
      { host: "api.example.com", ports: [443], scope: "all" },
      { host: "10.20.0.0/16", ports: [22], scope: "shell" },
    ],
    { resolver: resolver({ "api.example.com": ["93.184.216.34"] }) },
  );
  expect(p.allows("api.example.com", 443, "module")).toBe(true);
  expect(p.allows("api.example.com", 80, "module")).toBe(false);
  expect(p.allows("10.20.1.5", 22, "shell")).toBe(true);
  expect(p.allows("10.20.1.5", 22, "module")).toBe(false);
});

test("checkTarget rejects private DNS unless an explicit IP/CIDR rule exists", async () => {
  const p = new EgressPolicy(
    [{ host: "public.example.com", ports: [443], scope: "module" }],
    { resolver: resolver({ "public.example.com": ["127.0.0.1"] }) },
  );
  const decision = await p.checkTarget("public.example.com", 443, "module");
  expect(decision.allowed).toBe(false);
  expect(decision.reason).toContain("private");

  const explicit = new EgressPolicy(
    [
      { host: "public.example.com", ports: [443], scope: "module" },
      { host: "127.0.0.0/8", ports: [443], scope: "module" },
    ],
    { resolver: resolver({ "public.example.com": ["127.0.0.1"] }) },
  );
  expect((await explicit.checkTarget("public.example.com", 443, "module")).allowed).toBe(true);
});

test("checkTarget fails closed when any resolved address is not allowed", async () => {
  const p = new EgressPolicy(
    [{ host: "mixed.example.com", ports: [443], scope: "module" }, { host: "93.184.216.34", ports: [443], scope: "module" }],
    { resolver: resolver({ "mixed.example.com": ["93.184.216.34", "10.0.0.5"] }) },
  );
  const decision = await p.checkTarget("mixed.example.com", 443, "module");
  expect(decision.allowed).toBe(false);
  expect(decision.addresses).toEqual(["93.184.216.34", "10.0.0.5"]);
});

test("http module refuses a URL outside the destination policy", async () => {
  registerAllModules();
  const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  servers.push({ stop: () => server.stop(true) });
  const url = `http://127.0.0.1:${server.port}/`;
  const inv: NormalizedInventory = { groups: { all: { hosts: ["h1"], vars: {} } } };
  const pb = (args: Record<string, unknown>): NormalizedPlaybook[] => [
    { hosts: ["all"], vars: {}, tasks: [{ name: "t", module: "http", args, notify: [] }] },
  ];

  const denied = await runPlaybook(pb({ url, return_content: true }), inv, {
    connectionFor: () => createNoopConnection(),
    isolation: { backend: "none", egress: [{ host: "10.0.0.0/8", ports: [80], scope: "module" }] },
  });
  expect(denied.hosts["h1"]![0]!.failed).toBe(true);
  expect(denied.hosts["h1"]![0]!.iterations[0]!.msg).toContain("egress denied");

  const allowed = await runPlaybook(pb({ url, return_content: true }), inv, {
    connectionFor: () => createNoopConnection(),
    isolation: { backend: "none", egress: [{ host: "127.0.0.1", ports: [server.port], scope: "module" }] },
  });
  expect(allowed.hosts["h1"]![0]!.failed).toBe(false);
});
