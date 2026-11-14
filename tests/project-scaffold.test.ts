// ADR 0030 minimal scaffold used by `convert ansible --project`.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ensureProjectScaffold, namespaceSlug } from "../src/project/scaffold";

const tmp = (suffix: string) => mkdtempSync(join(tmpdir(), `rolecall-scaffold-${suffix}-`));

describe("project scaffold", () => {
  test("creates the documented layout and is idempotent", () => {
    const root = join(tmp("create"), "My Project");
    const first = ensureProjectScaffold(root, { name: "My Project" });
    expect(first.name).toBe("My Project");
    expect(first.namespace).toBe("my-project");
    expect(existsSync(join(root, "rolecall.yaml"))).toBe(true);
    expect(existsSync(join(root, "playbooks"))).toBe(true);
    expect(existsSync(join(root, "inventory", "inventory.yaml"))).toBe(true);
    expect(existsSync(join(root, "plugins", "modules", "my-project"))).toBe(true);
    expect(existsSync(join(root, ".rolecall", "isolation.yaml"))).toBe(true);
    expect(readFileSync(join(root, "rolecall.yaml"), "utf8")).toContain("My Project");

    writeFileSync(join(root, "rolecall.yaml"), "name: edited\n");
    const second = ensureProjectScaffold(root, { name: "My Project" });
    expect(second.created).toEqual([]);
    expect(readFileSync(join(root, "rolecall.yaml"), "utf8")).toBe("name: edited\n");
  });

  test("fills missing pieces without overwriting an existing project", () => {
    const root = tmp("existing");
    writeFileSync(join(root, "rolecall.yaml"), "name: existing\n");
    const result = ensureProjectScaffold(root, { name: "ignored" });
    expect(result.created.length).toBeGreaterThan(0);
    expect(readFileSync(join(root, "rolecall.yaml"), "utf8")).toBe("name: existing\n");
    expect(existsSync(join(root, "playbooks"))).toBe(true);
  });

  test("namespaceSlug normalizes unsafe names", () => {
    expect(namespaceSlug("My Site!")).toBe("my-site");
    expect(namespaceSlug("  ")).toBe("project");
  });
});
