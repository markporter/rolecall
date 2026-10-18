import { CliError } from "./types";

/**
 * @summary Parse a raw `--extra-vars` string (`key=value` pairs, whitespace-separated) into a var map.
 * @param raw Raw flag value, or undefined.
 * @returns Key→value map (values are strings); empty when `raw` is absent.
 * @throws {CliError} When a token lacks a `=` separator.
 */
export function parseExtraVars(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  const out: Record<string, unknown> = {};
  for (const pair of raw.trim().split(/\s+/)) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq < 0) throw new CliError(true, `--extra-vars expects key=value pairs (got '${pair}')`);
    out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return out;
}
