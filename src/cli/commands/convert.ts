// `rolecall convert ansible` — ADR 0024 analyzer/rewriter/handoff command.

import { existsSync } from "node:fs";

import { convertAnsible, validateConvertedTree } from "../../convert/ansible";
import { CliError, type CliResult, type ConvertResult, type GlobalFlags } from "../types";

/**
 * @summary Handle `rolecall convert ansible <path>` and `rolecall convert ansible --validate <dir>`.
 * @param sub Subcommand (must be `ansible`).
 * @param rest Positional arguments after the subcommand.
 * @param flags Parsed global/command flags.
 * @returns Structured conversion or validation result.
 */
export async function runConvertCommand(
  sub: string | undefined,
  rest: string[],
  flags: GlobalFlags,
): Promise<CliResult> {
  if (sub !== "ansible") {
    throw new CliError(true, `unknown convert subcommand '${sub ?? ""}' (expected: ansible)`);
  }

  if (flags.validate !== undefined) {
    if (!existsSync(flags.validate)) {
      throw new CliError(true, `convert ansible --validate: directory not found: ${flags.validate}`);
    }
    const validated = validateConvertedTree(flags.validate);
    const failed = validated.filter((entry) => !entry.ok);
    const result: ConvertResult = {
      command: "convert ansible",
      mode: "validate",
      source: flags.validate,
      out: flags.validate,
      handoff: "",
      applied: false,
      files: [],
      written: [],
      totals: { files: validated.length, mapped: 0, review: 0, handoff: failed.length, findings: failed.length },
      findings: failed.map((entry) => ({
        file: entry.file,
        path: "",
        construct: "validate",
        disposition: "handoff" as const,
        message: entry.error ?? "validation failed",
      })),
      validated,
      ...(failed.length > 0 ? { strictFailed: true } : {}),
    };
    return result;
  }

  const source = rest[0];
  if (source === undefined || source.length === 0) {
    throw new CliError(true, "convert ansible requires a <path> argument");
  }
  if (!existsSync(source)) {
    throw new CliError(false, `convert ansible: path not found: ${source}`);
  }
  if (flags.report !== undefined && flags.report !== "json" && flags.report !== "md") {
    throw new CliError(true, `--report must be json or md (got '${flags.report}')`);
  }

  if (flags.report === "json") flags.output = "json";

  const result = convertAnsible(source, {
    ...(flags.out !== undefined ? { out: flags.out } : {}),
    ...(flags.project !== undefined ? { project: flags.project } : {}),
    ...(flags.handoff !== undefined ? { handoff: flags.handoff } : {}),
    write: flags.write === true,
    strict: flags.strict === true,
    ...(flags.report !== undefined ? { report: flags.report } : {}),
  });

  const nonMechanical = result.totals.review + result.totals.handoff;
  if (flags.strict === true && nonMechanical > 0) {
    result.strictFailed = true;
  }
  return result;
}
