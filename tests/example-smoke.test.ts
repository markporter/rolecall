// Checked-in example smoke test: the local example must run under the default
// ADR 0025 sandbox on Linux. Spawns the real CLI so global module/env state from
// other tests cannot leak into the example run.

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { probeIsolation } from "../src/isolation";

test("examples/local-smoke runs under the default isolation backend", () => {
  const probe = probeIsolation({ backend: "auto" });
  if (probe.selected === "none") return;
  const cli = resolve("src/cli/index.ts");
  const res = spawnSync(
    process.execPath,
    [
      cli,
      "playbook",
      "run",
      resolve("examples/local-smoke/playbook.yaml"),
      "--inventory",
      resolve("examples/local-smoke/inventory.yaml"),
      "-o",
      "json",
    ],
    {
      cwd: resolve("."),
      env: { ...process.env, ROLECALL_ISOLATION: "auto" },
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  expect(res.status).toBe(0);
  const body = JSON.parse(res.stdout) as { totals?: { failed?: number; ok?: number } };
  expect(body.totals?.failed).toBe(0);
  expect(body.totals?.ok).toBe(1);
}, 40_000);
