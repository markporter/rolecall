import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("install.sh --from-dir hands off to the binary install command", () => {
  const dir = mkdtempSync(join(tmpdir(), "rolecall-bootstrap-"));
  const record = join(dir, "args.txt");
  const bin = join(dir, "rolecall");
  writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(record)}\n`, { mode: 0o755 });
  try {
    const res = spawnSync("sh", [
      resolve("install.sh"),
      "--from-dir", dir,
      "--user",
      "--no-service",
      "--yes",
      "--dry-run",
    ], { encoding: "utf8" });
    expect(res.status).toBe(0);
    const args = readFileSync(record, "utf8").trim().split("\n");
    expect(args[0]).toBe("install");
    expect(args).toContain("--from-dir");
    expect(args).toContain(dir);
    expect(args).toContain("--user");
    expect(args).toContain("--no-service");
    expect(args).toContain("--yes");
    expect(args).toContain("--dry-run");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
