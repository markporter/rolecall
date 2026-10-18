import { describe, expect, test } from "bun:test";
import { load as yamlLoad } from "js-yaml";

import { registerAllModules } from "../src/modules/builtins";
import { searchModules } from "../src/modules/search";
import { lintTemplateRefs } from "../src/config/loader";
import type { NormalizedPlaybook, NormalizedTask } from "../src/config/schema";

function lintExample(ex: string): ReturnType<typeof lintTemplateRefs> {
  const parsed = yamlLoad(ex) as unknown;
  const rawTasks = Array.isArray(parsed) ? parsed : [parsed];
  const tasks: NormalizedTask[] = (rawTasks as Array<Record<string, unknown>>).map((t) => ({
    name: (t.name as string) ?? "example",
    ...(t.module !== undefined ? { module: t.module as string } : {}),
    args: (t.args as Record<string, unknown>) ?? {},
    notify: [],
  }));
  const pb: NormalizedPlaybook = {
    name: "example-playbook",
    hosts: ["all"],
    tasks,
    vars: {},
  };
  return lintTemplateRefs(pb);
}

function hardProblems(problems: ReturnType<typeof lintTemplateRefs>) {
  return problems.filter((p) => p.kind === "jinja" || p.kind === "namespace-unknown");
}

describe("module metadata examples", () => {
    test("lint cleanly", () => {
    registerAllModules();
    const modules = searchModules("");
    expect(modules.length).toBeGreaterThanOrEqual(12);

    for (const m of modules) {
      for (const ex of m.examples ?? []) {
        const relevant = hardProblems(lintExample(ex));
        expect(relevant, `module '${m.name}' example failed lint: ${JSON.stringify(relevant)}`).toEqual([]);
      }
    }
  });

  test("assert example: old {{ }} form fails, new structured ref passes", () => {
    const OLD = "- module: assert\n  args: { that: '{{ facts.ok }}', msg: 'precondition failed' }";
    const NEW = "- module: assert\n  args: { that: { $var: vars.ok }, msg: 'precondition failed' }";

    const oldProblems = hardProblems(lintExample(OLD));
    expect(oldProblems.length).toBeGreaterThan(0);
    expect(oldProblems.some((p) => p.kind === "jinja")).toBe(true);

    const newProblems = hardProblems(lintExample(NEW));
    expect(newProblems).toEqual([]);
  });
});
