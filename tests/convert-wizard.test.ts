// Interactive `rolecall convert` wizard (bare invocation).

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runConvertCommand } from "../src/cli/commands/convert";
import type { ConvertResult, GlobalFlags } from "../src/cli/types";

const tmp = (suffix: string) => mkdtempSync(join(tmpdir(), `rolecall-convert-wizard-${suffix}-`));

function sourceProject(root: string): string {
  const source = join(root, "ansible");
  mkdirSync(join(source, "playbooks"), { recursive: true });
  writeFileSync(join(source, "playbooks", "site.yml"), `- hosts: web\n  tasks:\n    - name: t\n      debug:\n        msg: ok\n`);
  return source;
}

describe("convert wizard", () => {
  test("prompts for source/project and applies the conversion", async () => {
    const root = tmp("happy");
    const source = sourceProject(root);
    const project = join(root, "converted");
    const answers = [source, project, "", "", "", "", ""];
    const ask = async (_q: string, fallback: string) => answers.shift() ?? fallback;
    const result = (await runConvertCommand(undefined, [], {} as GlobalFlags, {
      interactive: true,
      ask,
    })) as ConvertResult;
    expect(result.command).toBe("convert ansible");
    expect(result.project?.root).toBe(project);
    expect(result.applied).toBe(true);
    expect(existsSync(join(project, "rolecall.yaml"))).toBe(true);
    expect(existsSync(join(project, "playbooks", "site.yml"))).toBe(true);
  });

  test("declining apply leaves the tree unwritten", async () => {
    const root = tmp("dry");
    const source = sourceProject(root);
    const project = join(root, "converted");
    const answers = [source, project, "", "", "", "", "n"];
    const ask = async (_q: string, fallback: string) => answers.shift() ?? fallback;
    const result = (await runConvertCommand(undefined, [], {} as GlobalFlags, {
      interactive: true,
      ask,
    })) as ConvertResult;
    expect(result.applied).toBe(false);
    expect(existsSync(join(project, "playbooks", "site.yml"))).toBe(false);
  });

  test("--yes applies write defaults without prompting", async () => {
    const root = tmp("yes");
    const source = sourceProject(root);
    const project = join(root, "converted");
    const result = (await runConvertCommand(
      "ansible",
      [source],
      { project, yes: true } as GlobalFlags,
      { interactive: false },
    )) as ConvertResult;
    expect(result.applied).toBe(true);
    expect(existsSync(join(project, "playbooks", "site.yml"))).toBe(true);
  });

  test("non-interactive bare convert errors with guidance", async () => {
    await expect(
      runConvertCommand(undefined, [], {} as GlobalFlags, { interactive: false }),
    ).rejects.toThrow(/requires a <path> argument/);
  });

  test("shorthand path is accepted", async () => {
    const root = tmp("shorthand");
    const source = sourceProject(root);
    const project = join(root, "converted");
    const result = (await runConvertCommand(
      source,
      [],
      { project, write: true } as GlobalFlags,
      { interactive: false },
    )) as ConvertResult;
    expect(result.applied).toBe(true);
    expect(existsSync(join(project, "playbooks", "site.yml"))).toBe(true);
  });
});
