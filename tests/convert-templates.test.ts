// ADR 0031 slice 1 — template analyzer classification.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { analyzeTemplate } from "../src/convert/templates";
import { convertAnsible } from "../src/convert/ansible";

const tmp = (suffix: string) => mkdtempSync(join(tmpdir(), `rolecall-template-${suffix}-`));

describe("template analyzer", () => {
  test("classifies output/if/for/set as mapped", () => {
    const analysis = analyzeTemplate(
      `{% set greeting = "hi" %}{% for user in users %}{% if user.active %}{{ loop.index }} {{ user.name | upper }}{% endif %}{% endfor %}`,
      "ok.j2",
    );
    expect(analysis.disposition).toBe("mapped");
    expect(analysis.findings).toContainEqual(
      expect.objectContaining({ construct: "template", disposition: "mapped" }),
    );
  });

  test("flags omit, trim markers, and set-blocks as review", () => {
    const analysis = analyzeTemplate(
      `{%- set x %}a{% endset -%}\n{{ missing | default(omit) }}`,
      "review.j2",
    );
    expect(analysis.disposition).toBe("review");
    expect(analysis.findings.some((f) => f.construct === "default(omit)" && f.disposition === "review")).toBe(true);
    expect(analysis.findings.some((f) => f.construct === "whitespace-trim")).toBe(true);
    expect(analysis.findings.some((f) => f.construct === "set-block")).toBe(true);
  });

  test("flags macros, lookups, and unknown filters as handoff", () => {
    const analysis = analyzeTemplate(
      `{% macro m() %}x{% endmacro %}{{ lookup("file", "x") }}{{ y | frobnicate }}`,
      "handoff.j2",
    );
    expect(analysis.disposition).toBe("handoff");
    expect(analysis.findings.some((f) => f.construct === "macro" && f.disposition === "handoff")).toBe(true);
    expect(analysis.findings.some((f) => f.construct === "lookup" && f.disposition === "handoff")).toBe(true);
    expect(analysis.findings.some((f) => f.construct === "filter:frobnicate" && f.disposition === "handoff")).toBe(true);
  });
});

describe("convert ansible --templates eta (analyzer only)", () => {
  test("records template findings and writes per-item handoff files", () => {
    const dir = tmp("project");
    mkdirSync(join(dir, "playbooks"), { recursive: true });
    writeFileSync(join(dir, "playbooks", "site.yml"), `- hosts: web\n  tasks:\n    - name: t\n      template:\n        src: app.j2\n        dest: /etc/app.conf\n`);
    writeFileSync(join(dir, "playbooks", "app.j2"), `{{ value | frobnicate }}`);
    const result = convertAnsible(dir, { templates: "eta", write: true, out: join(dir, "out") });
    expect(result.findings.some((f) => f.construct === "filter:frobnicate" && f.disposition === "handoff")).toBe(true);
    const items = readdirSync(join(result.handoff, "items"));
    expect(items.length).toBeGreaterThan(0);
    expect(readFileSync(join(result.handoff, "items", items[0]!), "utf8")).toContain("File:");
  });

  test("keep mode does not analyze templates", () => {
    const dir = tmp("keep");
    mkdirSync(join(dir, "playbooks"), { recursive: true });
    writeFileSync(join(dir, "playbooks", "site.yml"), `- hosts: web\n  tasks:\n    - name: t\n      template:\n        src: app.j2\n        dest: /etc/app.conf\n`);
    writeFileSync(join(dir, "playbooks", "app.j2"), `{{ value | frobnicate }}`);
    const result = convertAnsible(dir, { templates: "keep", write: true, out: join(dir, "out") });
    expect(result.findings.some((f) => f.construct === "filter:frobnicate")).toBe(false);
  });
});
