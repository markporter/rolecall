// Candidate-vs-running configuration diff for network devices.
//
// Normalizes raw CLI config text (CRLF→LF, strip trailing whitespace), then
// computes a line-level diff via the installed `diff` library. The result drives
// merge (apply only the delta) vs replace (apply the whole candidate) semantics
// in NetworkSshConnection.
import { diffLines, type Change } from "diff";

export interface ConfigDiff {
  /** True when candidate and running differ after normalization. */
  changed: boolean;
  /** Lines present in candidate but not running (the delta to merge in). */
  added: string[];
  /** Lines present in running but not candidate (removed by a merge). */
  removed: string[];
  /** Raw change objects from `diffLines` (old=running, new=candidate). */
  changes: Change[];
}

/** Normalize config text: CRLF→LF, strip trailing whitespace per line, drop trailing blank lines. */
export function normalizeConfig(text: string): string {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

// diffLines values end with a trailing "\n"; drop it before splitting so we don't
// emit a spurious empty line, while preserving genuine blank lines in the body.
function toLines(value: string): string[] {
  const trimmed = value.endsWith("\n") ? value.slice(0, -1) : value;
  return trimmed.length === 0 ? [] : trimmed.split("\n");
}

/**
 * Diff a candidate config against the device running config.
 * `old` is running, `new` is candidate, so `added` = candidate-only lines.
 */
export function diffConfigs(candidate: string, running: string): ConfigDiff {
  const c = normalizeConfig(candidate);
  const r = normalizeConfig(running);
  if (c === r) {
    return { changed: false, added: [], removed: [], changes: [] };
  }
  const changes = diffLines(r, c);
  const added: string[] = [];
  const removed: string[] = [];
  for (const ch of changes) {
    if (ch.added) added.push(...toLines(ch.value));
    else if (ch.removed) removed.push(...toLines(ch.value));
  }
  return { changed: true, added, removed, changes };
}
