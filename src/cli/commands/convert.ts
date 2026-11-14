// `rolecall convert ansible` — ADR 0024 analyzer/rewriter/handoff command.
// Bare `rolecall convert` in a TTY opens a small wizard (source -> project ->
// apply/handoff/strict) modeled on the install/project-create flow.

import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { convertAnsible, validateConvertedTree } from "../../convert/ansible";
import { CliError, type CliResult, type ConvertResult, type GlobalFlags } from "../types";
import { confirm, createAsk, isInteractive } from "../prompt";

/** Injectable wizard hooks for tests. */
export interface ConvertWizardOptions {
  /** Force/disable prompting (defaults to TTY + no --yes/--dry-run/--non-interactive). */
  interactive?: boolean;
  /** Injectable prompt for tests. */
  ask?: (question: string, fallback: string) => Promise<string>;
}

function validationResult(dir: string): ConvertResult {
  if (!existsSync(dir)) {
    throw new CliError(true, `convert ansible --validate: directory not found: ${dir}`);
  }
  const validated = validateConvertedTree(dir);
  const failed = validated.filter((entry) => !entry.ok);
  return {
    command: "convert ansible",
    mode: "validate",
    source: dir,
    out: dir,
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
}

/**
 * @summary Handle `rolecall convert` (interactive wizard), `convert [ansible] <path>`, and `convert ansible --validate <dir>`.
 * @param sub Subcommand (`ansible`) or a shorthand source path.
 * @param rest Positional arguments after the subcommand.
 * @param flags Parsed global/command flags.
 * @param opts Optional injected wizard hooks (tests).
 * @returns Structured conversion or validation result.
 */
export async function runConvertCommand(
  sub: string | undefined,
  rest: string[],
  flags: GlobalFlags,
  opts: ConvertWizardOptions = {},
): Promise<CliResult> {
  if (flags.validate !== undefined) return validationResult(flags.validate);

  const shorthandSource = sub !== undefined && sub !== "ansible" && existsSync(sub) ? sub : undefined;
  if (sub !== undefined && sub !== "ansible" && shorthandSource === undefined) {
    throw new CliError(true, `unknown convert subcommand '${sub}' (expected: ansible)`);
  }

  const interactive = opts.interactive ?? isInteractive(flags);
  const ask = createAsk(opts.ask);
  let source = shorthandSource ?? rest[0];

  if (source === undefined || source.length === 0) {
    if (!interactive) {
      throw new CliError(true, "convert requires a <path> argument (or run in a TTY for the wizard)");
    }
    source = await ask("Ansible source path", ".");
  }
  if (!existsSync(source)) {
    throw new CliError(false, `convert: path not found: ${source}`);
  }
  if (flags.report !== undefined && flags.report !== "json" && flags.report !== "md") {
    throw new CliError(true, `--report must be json or md (got '${flags.report}')`);
  }
  if (flags.templates !== undefined && flags.templates !== "keep" && flags.templates !== "eta") {
    throw new CliError(true, `--templates must be keep or eta (got '${flags.templates}')`);
  }

  let project = flags.project;
  let write = flags.dryRun === true ? false : flags.write === true || flags.yes === true;
  let strict = flags.strict === true;
  let handoff = flags.handoff;
  let templates: "keep" | "eta" = flags.templates === "eta" ? "eta" : "keep";

  if (interactive) {
    if (project === undefined) {
      const defaultProject = `${basename(resolve(source))}-rolecall`;
      project = await ask("Target RoleCall project directory", defaultProject);
    }
    if (flags.write !== true && flags.dryRun !== true) {
      write = await confirm(ask, `Write converted files into ${project}?`, true);
    }
    if (handoff === undefined) {
      const wantHandoff = await confirm(ask, "Write the review/handoff bundle?", true);
      if (wantHandoff) handoff = join(project, "handoff");
    }
    if (flags.strict !== true) {
      strict = await confirm(ask, "Fail on review/handoff items (strict)?", false);
    }
    if (flags.templates === undefined) {
      const analyzeTemplates = await confirm(
        ask,
        "Convert mechanically-safe Jinja templates to Eta? (mapped subset only)",
        false,
      );
      if (analyzeTemplates) templates = "eta";
    }
    if (write) {
      const apply = await confirm(ask, "Apply this conversion?", true);
      if (!apply) write = false;
    }
  }

  if (flags.yes === true && handoff === undefined && project !== undefined) {
    handoff = join(project, "handoff");
  }

  if (flags.report === "json") flags.output = "json";

  const out = flags.out ?? (!write ? project : undefined);
  const result = convertAnsible(source, {
    ...(out !== undefined ? { out } : {}),
    ...(write && project !== undefined ? { project } : {}),
    ...(handoff !== undefined ? { handoff } : {}),
    write,
    strict,
    templates,
    ...(flags.report !== undefined ? { report: flags.report } : {}),
  });

  const nonMechanical = result.totals.review + result.totals.handoff;
  if (strict && nonMechanical > 0) result.strictFailed = true;
  return result;
}
