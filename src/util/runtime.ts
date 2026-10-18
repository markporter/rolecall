// Runtime detection — dependency-free.
// Bun exposes process.versions.bun; Node does not. A ROLECALL_RUNTIME env override
// forces the result (used in tests / dual-runtime parity work later).
/** @summary Union of supported JS runtime names resolved by detectRuntime(). */
export type RuntimeName = "bun" | "node";

/** @summary Detected runtime identity together with its version string. */
export interface RuntimeInfo {
  name: RuntimeName;
  version: string;
}

/** Detect the current JS runtime (bun/node), overridable via ROLECALL_RUNTIME env. */
export function detectRuntime(): RuntimeInfo {
  const override = process.env["ROLECALL_RUNTIME"];
  if (override === "bun" || override === "node") {
    const versions = process.versions as Record<string, string | undefined>;
    const version = override === "bun" ? versions["bun"] ?? "" : versions["node"] ?? "";
    return { name: override, version };
  }

  const versions = process.versions as Record<string, string | undefined>;
  const bunVersion = versions["bun"];
  if (bunVersion) {
    return { name: "bun", version: bunVersion };
  }
  return { name: "node", version: versions["node"] ?? "" };
}
