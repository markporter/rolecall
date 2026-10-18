import { CliError } from "./types";

/**
 * @summary Parse a raw `--tags` / `--skip-tags` value (comma-separated, whitespace-trimmed) into a tag list.
 * @param raw Raw flag value.
 * @param flag Flag name used in the error message (e.g. `--tags`).
 * @returns Trimmed, non-empty tag names in order; an empty list when `raw` is absent.
 * @throws {CliError} When the value is present but yields no tags (empty/whitespace-only), so the
 * user gets a usage error (exit 2) instead of a silently-ignored filter.
 */
export function parseTagList(raw: string | undefined, flag: string): string[] {
  if (raw === undefined) return [];
  const tags = raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tags.length === 0) {
    throw new CliError(true, `${flag} requires at least one tag name (comma-separated)`);
  }
  return tags;
}
