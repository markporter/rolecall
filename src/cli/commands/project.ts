// `rolecall project create|init` — ADR 0030 project scaffolding.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { ensureProjectScaffold, namespaceSlug } from "../../project/scaffold";
import { CliError, type CliResult, type GlobalFlags, type ProjectResult } from "../types";
import { createAsk, isInteractive } from "../prompt";

/** Injectable wizard hooks for tests. */
export interface ProjectWizardOptions {
  interactive?: boolean;
  ask?: (question: string, fallback: string) => Promise<string>;
}

function isEmptyDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory() && readdirSync(path).length === 0;
  } catch {
    return false;
  }
}

/**
 * @summary Handle `rolecall project create <name>` and `rolecall project init`.
 * @param sub `create` or `init`.
 * @param rest Positional arguments (the name for `create`).
 * @param flags Parsed global/command flags.
 * @param opts Injectable wizard hooks (tests).
 * @returns Structured project scaffold result.
 */
export async function runProjectCommand(
  sub: string | undefined,
  rest: string[],
  flags: GlobalFlags,
  opts: ProjectWizardOptions = {},
): Promise<CliResult> {
  if (sub !== "create" && sub !== "init") {
    throw new CliError(true, `unknown project subcommand '${sub ?? ""}' (expected: create|init)`);
  }
  const interactive = opts.interactive ?? isInteractive(flags);
  const ask = createAsk(opts.ask);

  let name = flags.name;
  let dir = flags.dir;
  let namespace = flags.namespace;
  let vcs = flags.vcs ?? "none";

  if (sub === "create") {
    name = name ?? rest[0];
    if (name === undefined || name.length === 0) {
      if (!interactive) throw new CliError(true, "project create requires a <name>");
      name = await ask("Project name", "my-project");
    }
    if (dir === undefined) {
      const defaultDir = join(process.cwd(), namespaceSlug(name));
      dir = interactive ? await ask("Project directory", defaultDir) : defaultDir;
    }
  } else {
    dir = dir ?? process.cwd();
    name = name ?? basename(resolve(dir));
    if (interactive) name = await ask("Project name", name);
  }

  if (namespace === undefined) namespace = namespaceSlug(name);
  if (vcs !== "none" && vcs !== "git") {
    throw new CliError(true, `--vcs must be none or git (got '${vcs}')`);
  }
  if (interactive && flags.vcs === undefined) {
    const answer = await ask("VCS (none/git)", vcs);
    if (answer !== "none" && answer !== "git") throw new CliError(true, `invalid vcs '${answer}'`);
    vcs = answer;
  }

  const root = resolve(dir);
  if (existsSync(root) && !isEmptyDirectory(root) && flags.force !== true) {
    throw new CliError(
      false,
      `project ${sub}: ${root} is not empty; pass --force to fill in missing scaffold files`,
    );
  }

  if (flags.dryRun === true) {
    return {
      command: sub === "create" ? "project create" : "project init",
      root,
      name,
      namespace,
      vcs: vcs === "git" ? "git" : "none",
      created: [],
      applied: false,
    };
  }

  const scaffold = ensureProjectScaffold(root, { name, namespace });
  if (vcs === "git") {
    const git = spawnSync("git", ["init"], { cwd: root, stdio: "ignore" });
    if (git.status !== 0) throw new CliError(false, `project ${sub}: 'git init' failed in ${root}`);
    const ignore = join(root, ".gitignore");
    if (!existsSync(ignore)) {
      writeFileSync(ignore, "node_modules/\n.rolecall/state.db\nconversion_gaps/\n", "utf8");
    }
  }

  const result: ProjectResult = {
    command: sub === "create" ? "project create" : "project init",
    root,
    name,
    namespace,
    vcs: vcs === "git" ? "git" : "none",
    created: scaffold.created,
    applied: true,
  };
  return result;
}
