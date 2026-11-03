// ADR 0023 install-kind detection and package-manager delegation.

import type { InstallKind } from "./plan";

export interface PackageManagerCommand {
  file: string;
  args: string[];
}

/** Detect how the running CLI was installed when no manifest is present. */
export function detectInstallKind(manifestKind?: InstallKind, argv1 = process.argv[1] ?? ""): InstallKind {
  if (manifestKind) return manifestKind;
  const path = argv1.replace(/\\/g, "/");
  if (path.includes("/.bun/install/global/") || path.includes("/bun/install/global/")) return "bun-global";
  if (path.includes("/node_modules/") || path.endsWith("/lib/cli.js")) return "npm";
  if (path.endsWith(".ts") || path.endsWith("/src/cli/index.ts")) return "source";
  return "binary";
}

/** Package-manager command for an update, or undefined for kinds that must be delegated manually. */
export function packageManagerUpdateCommand(kind: InstallKind, version: string): PackageManagerCommand | undefined {
  if (kind === "npm") return { file: "npm", args: ["i", "-g", `@rolecall/cli@${version}`] };
  if (kind === "bun-global") return { file: "bun", args: ["add", "-g", `@rolecall/cli@${version}`] };
  return undefined;
}
