import { buildManifest } from "../../orchestrator/mcp";
import { CliError, type AgentManifestResult, type CliResult, type GlobalFlags } from "../types";

export async function runAgentCommand(
  sub: string | undefined,
  _rest: string[],
  _flags: GlobalFlags,
): Promise<CliResult> {
  if (sub !== "manifest") {
    throw new CliError(true, `unknown agent subcommand '${sub ?? ""}' (expected: manifest)`);
  }
  const result: AgentManifestResult = {
    command: "agent manifest",
    manifest: buildManifest(),
  };
  return result;
}
