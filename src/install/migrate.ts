// ADR 0023: one-time migration from the legacy ~/.rolecall state root to the
// XDG state root. Moves the DB (+WAL/SHM) and plugins.json, never overwrites,
// and leaves a note in the legacy directory.

import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import type { InstallLayout } from "./layout";

export interface MigrationResult {
  applied: boolean;
  migrated: string[];
  skipped: string[];
  note?: string;
}

const FILES = ["state.db", "state.db-wal", "state.db-shm", "plugins.json"];

/** Migrate legacy per-user state into the resolved XDG state directory. */
export function migrateLegacyState(
  layout: InstallLayout,
  opts: { legacyDir?: string; dryRun?: boolean; force?: boolean } = {},
): MigrationResult {
  const legacyDir = opts.legacyDir ?? join(process.env["ROLECALL_HOME"] ?? homedir(), ".rolecall");
  if (layout.scope !== "user") throw new Error("legacy ~/.rolecall migration only applies to user-scope installs");
  if (!legacyDir || legacyDir === layout.stateDir) return { applied: false, migrated: [], skipped: [] };

  const migrated: string[] = [];
  const skipped: string[] = [];
  const pairs = FILES.filter((f) => existsSync(join(legacyDir, f))).map((f) => ({
    from: join(legacyDir, f),
    to: join(layout.stateDir, f),
  }));
  if (pairs.length === 0) return { applied: false, migrated: [], skipped: [] };

  if (opts.dryRun === true) {
    return { applied: false, migrated: [], skipped: pairs.map((p) => p.from), note: `would migrate ${pairs.length} file(s)` };
  }

  mkdirSync(layout.stateDir, { recursive: true, mode: 0o700 });
  for (const { from, to } of pairs) {
    if (existsSync(to) && opts.force !== true) {
      skipped.push(from);
      continue;
    }
    try {
      renameSync(from, to);
    } catch {
      copyFileSync(from, to);
      rmSync(from, { force: true });
    }
    migrated.push(to);
  }
  const note = join(legacyDir, "MIGRATED.md");
  writeFileSync(
    note,
    `# Migrated\n\nRoleCall state was moved to:\n\n\`${layout.stateDir}\`\n\nThe legacy files were kept only if a target already existed. This directory is no longer used when the XDG state path exists.\n`,
    { mode: 0o600 },
  );
  return { applied: true, migrated, skipped, note };
}
