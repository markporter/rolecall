// `rolecall doctor` — report local isolation readiness.
//
// This is the first slice of ADR 0025: discovery only. Execution wrapping is
// wired separately; the probe tells installers/operators which backend would be
// selected and why, without mutating anything.

import { probeIsolation, type ProbeDeps } from "../../isolation";
import { resolveInstallLayout } from "../../install/layout";
import { existsSync } from "node:fs";
import type { IsolationBackendName } from "../../isolation";
import { CliError, type CliResult, type GlobalFlags } from "../types";

const BACKENDS: readonly IsolationBackendName[] = ["auto", "namespace", "docker", "none"];

export interface DoctorOptions {
  /** Injectable probe deps for deterministic tests. */
  probeDeps?: Partial<ProbeDeps>;
}

/** @summary Report the local isolation backend that would be selected, plus Docker/bwrap/userns probes. */
export async function runDoctorCommand(
  _flags: GlobalFlags,
  _rest: string[],
  opts: DoctorOptions = {},
): Promise<CliResult> {
  const requested = (_flags.isolation ?? "auto") as IsolationBackendName;
  if (!BACKENDS.includes(requested)) {
    throw new CliError(true, `unknown --isolation backend '${requested}' (expected: ${BACKENDS.join(", ")})`);
  }
  const isolation = probeIsolation({ backend: requested, deps: opts.probeDeps });
  const layout = resolveInstallLayout();
  return {
    command: "doctor",
    isolation,
    install: {
      scope: layout.scope,
      platform: layout.platform,
      programDir: layout.programDir,
      configDir: layout.configDir,
      stateDir: layout.stateDir,
      cacheDir: layout.cacheDir,
      binDir: layout.binDir,
      envFile: layout.envFile,
      envFileExists: existsSync(layout.envFile),
    },
    note: isolation.selected === "none"
      ? "no usable isolation backend; local execution would be unsandboxed (ADR 0025)"
      : `isolation backend '${isolation.selected}' is available`,
  };
}
