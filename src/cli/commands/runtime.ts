// `rolecall runtime install|status|remove` — ADR 0023 §5 optional Bun toolchain.
//
// The native binary already embeds Bun, so this manages only the opt-in
// standalone toolchain under <programDir>/runtime/bun/<version>/.

import { resolveInstallLayout } from "../../install/layout";
import { readInstallManifest, updateInstallManifest } from "../../install/plan";
import {
  bunRuntimeDir,
  hasLocalBun,
  installBunRuntime,
  listInstalledBunVersions,
  removeBunRuntime,
  runtimeStatus,
} from "../../install/runtime";
import type { FetchLike } from "../../install/release";
import { CliError, type CliResult, type GlobalFlags } from "../types";

const OPS = ["install", "status", "remove"] as const;
type RuntimeOperation = (typeof OPS)[number];

export interface RuntimeCommandOptions {
  /** Fetch override for tests. */
  fetchImpl?: FetchLike;
}

/** @summary Install, inspect, or remove the optional standalone Bun toolchain. @param sub Operation: install, status, or remove. @param flags Parsed global flags. @param opts Test overrides. @returns Structured RuntimeResult. */
export async function runRuntimeCommand(
  sub: string | undefined,
  _rest: string[],
  flags: GlobalFlags,
  opts: RuntimeCommandOptions = {},
): Promise<CliResult> {
  if (!sub || !OPS.includes(sub as RuntimeOperation)) {
    throw new CliError(true, `runtime requires one of: ${OPS.join(", ")}`);
  }
  const operation = sub as RuntimeOperation;
  if (flags.system === true && flags.user === true) {
    throw new CliError(true, "--system and --user are mutually exclusive");
  }
  const root = typeof process.getuid === "function" && process.getuid() === 0;
  const scope = flags.system === true ? "system" : flags.user === true ? "user" : root ? "system" : "user";
  const layout = resolveInstallLayout({
    scope,
    ...(flags.prefix ? { prefix: flags.prefix } : {}),
    ...(flags.configDir ? { configDir: flags.configDir } : {}),
    ...(flags.stateDir ? { stateDir: flags.stateDir } : {}),
  });
  const manifest = readInstallManifest(layout);

  if (operation === "status") {
    return {
      command: "runtime",
      operation,
      status: runtimeStatus(layout, manifest?.["runtime"]),
      applied: false,
      written: [],
      removed: [],
      note: "embedded is the default; an external toolchain is optional",
    };
  }

  const dryRun = flags.dryRun === true || flags.yes !== true;
  if (!dryRun && scope === "system" && !root) {
    throw new CliError(true, "system-scope runtime changes require root/Administrator");
  }

  if (operation === "install") {
    if (flags.fromDir && !hasLocalBun(flags.fromDir) && !flags.bunVersion) {
      throw new CliError(true, "--from-dir has no bun/ artifact; pass --bun-version to download Bun");
    }
    const result = await installBunRuntime(layout, {
      ...(flags.bunVersion ? { version: flags.bunVersion } : {}),
      ...(flags.fromDir && hasLocalBun(flags.fromDir) ? { fromDir: flags.fromDir } : {}),
      addToPath: flags.addBunToPath === true,
      dryRun,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    });
    if (!dryRun) {
      updateInstallManifest(layout, { runtime: result.version, runtimePath: result.bin });
    }
    return {
      command: "runtime",
      operation,
      status: runtimeStatus(layout, result.version),
      applied: !dryRun,
      version: result.version,
      dir: result.dir,
      bin: result.bin,
      source: result.source,
      written: result.written,
      removed: [],
      ...(result.pathLink ? { pathLink: result.pathLink } : {}),
      note: dryRun ? "dry-run; pass --yes to install" : `installed Bun ${result.version}`,
    };
  }

  const versions = flags.bunVersion ? [flags.bunVersion] : listInstalledBunVersions(layout);
  const planned = versions.map((version) => bunRuntimeDir(layout, version));
  if (dryRun) {
    return {
      command: "runtime",
      operation,
      status: runtimeStatus(layout, manifest?.["runtime"]),
      applied: false,
      written: [],
      removed: planned,
      note: planned.length > 0 ? "dry-run; pass --yes to remove" : "no external Bun toolchain installed",
    };
  }
  const removed = removeBunRuntime(layout, flags.bunVersion);
  const status = runtimeStatus(layout, undefined);
  if (manifest) {
    updateInstallManifest(layout, {
      runtime: status.kind === "external" ? status.version : "embedded",
      runtimePath: status.kind === "external" ? status.path : undefined,
    });
  }
  return {
    command: "runtime",
    operation,
    status,
    applied: true,
    written: [],
    removed,
    note: removed.length > 0 ? "removed external Bun toolchain" : "no external Bun toolchain installed",
  };
}
