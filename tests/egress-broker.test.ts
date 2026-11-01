// ADR 0025 egress broker core: HTTP CONNECT allow/deny with DNS pinning.

import { afterEach, expect, test } from "bun:test";
import { connect } from "node:net";
import { EgressPolicy } from "../src/isolation/egress";
import { startEgressBroker, type EgressAuditEvent } from "../src/isolation/egress-broker";

const servers: Array<{ stop: () => void }> = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.stop();
});

function readSocket(socket: ReturnType<typeof connect>, predicate: (s: string) => boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`timeout waiting for socket data (${out})`)), 5000);
    socket.on("data", (chunk) => {
      out += chunk.toString("utf8");
      if (predicate(out)) {
        clearTimeout(timer);
        resolve(out);
      }
    });
    socket.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function brokerFor(policy: EgressPolicy, events: EgressAuditEvent[]) {
  const broker = await startEgressBroker({ policy, audit: (e) => events.push(e) });
  const [host, port] = broker.address.split(":");
  return { broker, host: host!, port: Number(port) };
}

test("broker allows a whitelisted CONNECT target", async () => {
  const target = Bun.serve({ port: 0, fetch: () => new Response("broker-ok") });
  servers.push({ stop: () => target.stop(true) });
  const events: EgressAuditEvent[] = [];
  const policy = new EgressPolicy([{ host: "127.0.0.1", ports: [target.port], scope: "all" }]);
  const { broker, host, port } = await brokerFor(policy, events);
  const socket = connect({ host, port });
  try {
    const connected = readSocket(socket, (s) => s.includes("\r\n\r\n"));
    socket.write(`CONNECT 127.0.0.1:${target.port} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n`);
    expect(await connected).toContain("200 Connection Established");
    const response = readSocket(socket, (s) => s.includes("broker-ok"));
    socket.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1:${target.port}\r\nConnection: close\r\n\r\n`);
    expect(await response).toContain("broker-ok");
    expect(events[0]?.allowed).toBe(true);
  } finally {
    socket.destroy();
    await broker.close();
  }
});

test("broker denies a destination outside the whitelist", async () => {
  const events: EgressAuditEvent[] = [];
  const policy = new EgressPolicy([{ host: "10.0.0.0/8", ports: [80], scope: "all" }]);
  const { broker, host, port } = await brokerFor(policy, events);
  const socket = connect({ host, port });
  try {
    const response = readSocket(socket, (s) => s.includes("\r\n\r\n"));
    socket.write("CONNECT 127.0.0.1:80 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
    expect(await response).toContain("403 Forbidden");
    expect(events[0]?.allowed).toBe(false);
  } finally {
    socket.destroy();
    await broker.close();
  }
});
