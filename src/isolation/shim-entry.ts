// Resolve the RoleCall CLI entrypoint for the in-sandbox egress shim.
//
// This must not rely on process.argv[1] alone: under `bun test` that is the test
// runner, and compiled binaries have no script argv. Prefer an explicit hint,
// then the real CLI argv shapes, then the source entrypoint under Bun.

import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function resolveShimCliPath(): string | undefined {
  const hint = process.env["ROLECALL_CLI_ENTRY"];
  if (hint && existsSync(hint)) return resolve(hint);
  const argv1 = process.argv[1];
  if (argv1 && (/(^|[\\/])src[\\/]cli[\\/]index\.ts$/.test(argv1) || argv1.endsWith("lib/cli.js"))) {
    return resolve(argv1);
  }
  const sourceCli = resolve(import.meta.dir, "../../src/cli/index.ts");
  if (process.versions.bun && existsSync(sourceCli)) return sourceCli;
  return undefined;
}
