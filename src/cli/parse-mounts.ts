// Parse repeatable `--mount src:dst[:ro|rw]` isolation grants (ADR 0025).
// Windows drive letters (`C:\path`) are preserved rather than split as a mode.

import { isAbsolute } from "node:path";

import type { IsolationMount } from "../isolation/types";
import { CliError } from "./types";

function splitMount(spec: string): { source: string; target: string; mode: "ro" | "rw" } {
  const parts = spec.split(":");
  // Re-join a Windows drive-letter prefix (e.g. C:\data:D:\mnt).
  if (parts.length >= 2 && /^[A-Za-z]$/.test(parts[0] ?? "")) {
    parts.splice(0, 2, `${parts[0]}:${parts[1]}`);
  }
  let mode: "ro" | "rw" = "ro";
  const last = parts[parts.length - 1];
  if (last === "ro" || last === "rw") {
    mode = last;
    parts.pop();
  }
  if (parts.length !== 2) {
    throw new CliError(true, `--mount expects src:dst[:ro|rw] (got '${spec}')`);
  }
  const [source, target] = parts as [string, string];
  if (!isAbsolute(source) || !isAbsolute(target)) {
    throw new CliError(true, `--mount paths must be absolute (got '${spec}')`);
  }
  return { source, target, mode };
}

/** Parse zero or more `--mount` specs into validated isolation grants. */
export function parseMounts(specs: string[] | undefined): IsolationMount[] {
  return (specs ?? []).map((spec) => {
    const { source, target, mode } = splitMount(spec.trim());
    return { source, target, mode };
  });
}
