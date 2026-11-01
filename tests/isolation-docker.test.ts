// Live Docker backend test (ADR 0025). Skips when no daemon is present unless
// ROLECALL_REQUIRE_DOCKER=1, which the Docker CI job sets so the gate cannot
// silently pass without exercising the backend.

import { expect, test } from "bun:test";
import { probeIsolation } from "../src/isolation";
import { LocalConnection } from "../src/transport/local";

test("docker backend runs a command inside the container", async () => {
  const probe = probeIsolation({ backend: "docker" });
  const available = probe.selected === "docker" && probe.dockerDaemon;
  if (!available && process.env["ROLECALL_REQUIRE_DOCKER"] === "1") {
    throw new Error(`Docker backend unavailable: ${probe.warnings.join("; ")}`);
  }
  if (!available) return;

  const conn = new LocalConnection({
    kind: "local",
    host: "localhost",
    user: "tester",
    isolation: {
      backend: "docker",
      projectRoot: process.cwd(),
      image: process.env["ROLECALL_ISOLATION_IMAGE"] ?? "debian:bookworm-slim",
      network: "module",
    },
  });
  try {
    await conn.connect();
    const res = await conn.exec("echo docker-ok");
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("docker-ok");
  } finally {
    await conn.disconnect();
  }
}, 60_000);
