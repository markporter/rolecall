// ADR 0030 `rolecall project create|init`.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runProjectCommand } from "../src/cli/commands/project";
import type { GlobalFlags, ProjectResult } from "../src/cli/types";

const tmp = (suffix: string) => mkdtempSync(join(tmpdir(), `rolecall-project-${suffix}-`));

describe("project create/init", () => {
  test("create writes the documented scaffold", async () => {
    const root = join(tmp("create"), "site");
    const result = (await runProjectCommand(
      "create",
      ["My Site"],
      { dir: root } as GlobalFlags,
      { interactive: false },
    )) as ProjectResult;
    expect(result.command).toBe("project create");
    expect(result.name).toBe("My Site");
    expect(result.namespace).toBe("my-site");
    expect(result.root).toBe(root);
    expect(existsSync(join(root, "rolecall.yaml"))).toBe(true);
    expect(existsSync(join(root, "plugins", "modules", "my-site"))).toBe(true);
    expect(readFileSync(join(root, "rolecall.yaml"), "utf8")).toContain("My Site");
  });

  test("init scaffolds an existing empty directory", async () => {
    const root = tmp("init");
    const result = (await runProjectCommand(
      "init",
      [],
      { dir: root } as GlobalFlags,
      { interactive: false },
    )) as ProjectResult;
    expect(result.command).toBe("project init");
    expect(existsSync(join(root, "playbooks"))).toBe(true);
  });

  test("refuses a non-empty target unless --force", async () => {
    const root = tmp("force");
    writeFileSync(join(root, "keep.txt"), "x");
    await expect(
      runProjectCommand("init", [], { dir: root } as GlobalFlags, { interactive: false }),
    ).rejects.toThrow(/not empty/);
    const result = (await runProjectCommand(
      "init",
      [],
      { dir: root, force: true } as GlobalFlags,
      { interactive: false },
    )) as ProjectResult;
    expect(result.created.length).toBeGreaterThan(0);
    expect(readFileSync(join(root, "keep.txt"), "utf8")).toBe("x");
  });

  test("--vcs git initializes a repository and .gitignore", async () => {
    const root = join(tmp("git"), "site");
    await runProjectCommand(
      "create",
      ["site"],
      { dir: root, vcs: "git" } as GlobalFlags,
      { interactive: false },
    );
    expect(existsSync(join(root, ".git"))).toBe(true);
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toContain(".rolecall/state.db");
  });

  test("non-interactive create without a name errors", async () => {
    await expect(
      runProjectCommand("create", [], {} as GlobalFlags, { interactive: false }),
    ).rejects.toThrow(/requires a <name>/);
  });

  test("wizard asks for name/directory/vcs", async () => {
    const root = join(tmp("wizard"), "site");
    const answers = ["Wizard Site", root, "none"];
    const ask = async (_q: string, fallback: string) => answers.shift() ?? fallback;
    const result = (await runProjectCommand("create", [], {} as GlobalFlags, {
      interactive: true,
      ask,
    })) as ProjectResult;
    expect(result.name).toBe("Wizard Site");
    expect(result.root).toBe(root);
    expect(existsSync(join(root, "rolecall.yaml"))).toBe(true);
  });
});
