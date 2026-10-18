import { describe, it, expect } from "bun:test";
import type { Connection } from "../src/transport/connection";
import { FactsEngine } from "../src/facts/engine";

function fakeConnection(kind: Connection["kind"]): Connection {
  return {
    kind,
    async connect() {},
    async disconnect() {},
    async facts() {
      return { transport: kind, reachable: true };
    },
    async exec() {
      return { stdout: "active", stderr: "", exitCode: 0, ok: true };
    },
    async health() {
      return { ok: true, latencyMs: 1 };
    },
  } as unknown as Connection;
}

describe("FactsEngine connection-kind filtering", () => {
  it("runs ssh/local gatherers on an ssh connection", async () => {
    const engine = new FactsEngine();
    const out = await engine.gatherFacts(fakeConnection("ssh"), [], {});
    // os/network/service-posix all declare ssh/local; their facts appear.
    expect(out.os).toBeDefined();
    expect(out.hostname).toBeDefined();
    expect(out.service_status).toBeDefined();
  });

  it("excludes shell gatherers on an http connection", async () => {
    const engine = new FactsEngine();
    const out = await engine.gatherFacts(fakeConnection("http"), [], {});
    // os/network are ssh/local-only → absent; only service-http (health) runs.
    expect(out.os).toBeUndefined();
    expect(out.hostname).toBeUndefined();
    expect(out.service_status).toBe("running");
  });

  it("runs no built-in gatherers for network kind", async () => {
    const engine = new FactsEngine();
    const out = await engine.gatherFacts(fakeConnection("network"), [], {});
    expect(Object.keys(out)).toHaveLength(0);
  });

  it("honors connectionKinds on custom gatherers", async () => {
    const onlySsh = {
      name: "only-ssh",
      provides: ["custom_ssh_fact" as string],
      connectionKinds: ["ssh"] as const,
      async gather() {
        return { custom_ssh_fact: 1 };
      },
    };
    const engine = new FactsEngine({ gatherers: [onlySsh] });
    const sshOut = await engine.gatherFacts(fakeConnection("ssh"), [], {});
    expect(sshOut.custom_ssh_fact).toBe(1);
    const httpOut = await engine.gatherFacts(fakeConnection("http"), [], {});
    expect(httpOut.custom_ssh_fact).toBeUndefined();
  });
});
