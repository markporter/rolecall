// Golden corpus fixture for the Ansible -> RoleCall conversion pipeline.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { convertAnsible, validateConvertedTree } from "../src/convert/ansible";

const FIXTURE = join(import.meta.dir, "fixtures", "ansible-golden");

describe("golden Ansible corpus", () => {
  test("converts, rewrites templates, and validates the populated project", () => {
    const out = mkdtempSync(join(tmpdir(), "rolecall-golden-out-"));
    const result = convertAnsible(FIXTURE, { templates: "eta", write: true, out });

    const site = readFileSync(join(out, "playbooks", "site.yml"), "utf8");
    expect(site).toContain("package:");
    expect(site).toContain("run_mode: readonly");
    expect(site).toContain("tx: rc-block-1");
    expect(site).toContain("template_file: app.eta");
    expect(site).toContain("engine: eta");
    expect(site).toContain("template_file: unsupported.j2");
    expect(site).toContain("engine: jinja");

    expect(existsSync(join(out, "roles", "common", "templates", "app.eta"))).toBe(true);
    expect(existsSync(join(out, "roles", "common", "templates", "unsupported.j2"))).toBe(true);
    expect(existsSync(join(out, "roles", "common", "templates", "unsupported.eta"))).toBe(false);
    expect(existsSync(join(out, "roles", "common", "files", "app.conf"))).toBe(true);

    const groupVars = readFileSync(join(out, "group_vars", "all.yml"), "utf8");
    expect(groupVars).toContain("$jinja");

    expect(readFileSync(join(out, "handoff", "HANDOFF.md"), "utf8")).toContain("ignore_errors");
    expect(readdirSync(join(out, "handoff", "items")).length).toBeGreaterThan(0);
    expect(readdirSync(join(out, "handoff", "templates")).length).toBeGreaterThan(0);
    expect(result.totals.handoff).toBeGreaterThan(0);

    const validated = validateConvertedTree(out);
    expect(validated.length).toBeGreaterThan(0);
    expect(validated.every((entry) => entry.ok)).toBe(true);
  });
});
