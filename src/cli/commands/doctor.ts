// `rolecall doctor` — report local isolation readiness.
//
// This is the first slice of ADR 0025: discovery only. Execution wrapping is
// wired separately; the probe tells installers/operators which backend would be
// selected and why, without mutating anything.

import { probeIsolation, type ProbeDeps } from "../../isolation";
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
  return {
    command: "doctor",
    isolation,
    note: isolation.selected === "none"
      ? "no usable isolation backend; local execution would be unsandboxed (ADR 0025)"
      : `isolation backend '${isolation.selected}' is available`,
  };
}
