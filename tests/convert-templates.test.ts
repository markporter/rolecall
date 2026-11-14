// ADR 0031 slice 1 — template analyzer classification.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { analyzeTemplate, generateEta, generateEtaDraft } from "../src/convert/templates";
import { render } from "../src/templating/fast";
import { renderJinja } from "../src/templating/jinja";
import { convertAnsible, validateConvertedTree } from "../src/convert/ansible";

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

  test("flags omit and set-blocks as review", () => {
    const analysis = analyzeTemplate(
      `{%- set x %}a{% endset -%}\n{{ missing | default(omit) }}`,
      "review.j2",
    );
    expect(analysis.disposition).toBe("review");
    expect(analysis.findings.some((f) => f.construct === "default(omit)" && f.disposition === "review")).toBe(true);
    expect(analysis.findings.some((f) => f.construct === "set-block")).toBe(true);
  });

  test("trim markers are already applied by the parser and stay mapped", () => {
    const analysis = analyzeTemplate(`a {%- if x -%} b {%- endif -%} c`, "trim.j2");
    expect(analysis.disposition).toBe("mapped");
    const generated = generateEta(`a {%- if x -%} b {%- endif -%} c`, "trim.j2");
    expect(generated.ok).toBe(true);
    expect(render(generated.eta!, { x: true })).toBe(renderJinja(`a {%- if x -%} b {%- endif -%} c`, { x: true }));
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

describe("Eta codegen (mapped subset)", () => {
  test("renders the same output as the Jinja source for mapped constructs", () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["Hello {{ name }}", { name: "bob" }],
      ["{% if active %}yes{% else %}no{% endif %}", { active: true }],
      ["{% if active %}yes{% else %}no{% endif %}", { active: false }],
      ["{% for x in xs %}{{ loop.index }}:{{ x }};{% endfor %}", { xs: ["a", "b"] }],
      ["{% set y = x + 1 %}{{ y }}", { x: 2 }],
      ['{{ x | default("fallback") }}', {}],
      ["{% if x is defined %}yes{% else %}no{% endif %}", { x: 1 }],
      ["{% if x is defined %}yes{% else %}no{% endif %}", {}],
    ];
    const cycle = generateEta('{% for x in xs %}{{ loop.cycle("odd", "even") }}{% endfor %}', "cycle.j2");
    expect(cycle.ok).toBe(true);
    expect(render(cycle.eta!, { xs: [1, 2, 3] })).toBe("oddevenodd");

    const adjacent = generateEta(
      '{% for x in xs %}{{ loop.previtem }}-{{ x }}-{{ loop.nextitem }};{% endfor %}',
      "adjacent.j2",
    );
    expect(adjacent.ok).toBe(true);
    expect(render(adjacent.eta!, { xs: [1, 2, 3] })).toBe("-1-2;1-2-3;2-3-;");

    for (const [source, vars] of cases) {
      const generated = generateEta(source, "t.j2");
      expect(generated.ok).toBe(true);
      // Compare against the Nunjucks render of the same source.
      expect(render(generated.eta!, vars)).toBe(renderJinja(source, vars));
    }
  });
});

describe("review acceptance", () => {
  test("review constructs convert only when explicitly accepted", () => {
    const source = '{{ x | default(omit) }}';
    expect(generateEta(source, "review.j2").ok).toBe(false);
    const accepted = generateEta(source, "review.j2", { acceptReview: true });
    expect(accepted.ok).toBe(true);
  });
});

describe("partial Eta drafts", () => {
  test("marks unsupported constructs and remains compilable", () => {
    const draft = generateEtaDraft(
      `{% macro m() %}x{% endmacro %}Hello {{ name }} {{ value | frobnicate }}`,
      "draft.j2",
    );
    expect(draft).toContain("HANDOFF");
    expect(() => render(draft, { name: "bob" })).not.toThrow();
  });
});

describe("convert ansible --templates eta", () => {
  test("writes .eta and rewrites mapped task references", () => {
    const dir = tmp("eta");
    mkdirSync(join(dir, "playbooks"), { recursive: true });
    writeFileSync(join(dir, "playbooks", "site.yml"), `- hosts: web
  tasks:
    - name: t
      template:
        src: app.j2
        dest: /etc/app.conf
`);
    writeFileSync(join(dir, "playbooks", "app.j2"), `Hello {{ name }}`);
    const result = convertAnsible(dir, { templates: "eta", write: true, out: join(dir, "out") });
    expect(existsSync(join(dir, "out", "playbooks", "app.eta"))).toBe(true);
    expect(existsSync(join(dir, "out", "playbooks", "app.j2"))).toBe(false);
    const site = readFileSync(join(dir, "out", "playbooks", "site.yml"), "utf8");
    expect(site).toContain("template_file: app.eta");
    expect(site).toContain("engine: eta");
    expect(result.findings.some((f) => f.construct === "template" && f.disposition === "mapped")).toBe(true);
  });

  test("accepts review constructs when requested", () => {
    const dir = tmp("accept-review");
    mkdirSync(join(dir, "playbooks"), { recursive: true });
    writeFileSync(join(dir, "playbooks", "site.yml"), `- hosts: web
  tasks:
    - name: t
      template:
        src: app.j2
        dest: /etc/app.conf
`);
    writeFileSync(join(dir, "playbooks", "app.j2"), `{{ x | default(omit) }}`);
    const result = convertAnsible(dir, {
      templates: "eta",
      templatesReview: "accept",
      write: true,
      out: join(dir, "out"),
    });
    expect(existsSync(join(dir, "out", "playbooks", "app.eta"))).toBe(true);
    expect(result.findings.some((f) => f.disposition === "review" && f.message.includes("accepted"))).toBe(true);
  });

  test("keeps .j2 and Jinja for review/handoff templates", () => {
    const dir = tmp("keep-jinja");
    mkdirSync(join(dir, "playbooks"), { recursive: true });
    writeFileSync(join(dir, "playbooks", "site.yml"), `- hosts: web
  tasks:
    - name: t
      template:
        src: app.j2
        dest: /etc/app.conf
`);
    writeFileSync(join(dir, "playbooks", "app.j2"), `{{ value | frobnicate }}`);
    const result = convertAnsible(dir, { templates: "eta", write: true, out: join(dir, "out") });
    expect(existsSync(join(dir, "out", "playbooks", "app.j2"))).toBe(true);
    expect(existsSync(join(dir, "out", "playbooks", "app.eta"))).toBe(false);
    expect(readFileSync(join(dir, "out", "playbooks", "site.yml"), "utf8")).toContain("engine: jinja");
    const drafts = readdirSync(join(result.handoff, "templates"));
    expect(drafts.length).toBe(1);
    expect(readFileSync(join(result.handoff, "templates", drafts[0]!), "utf8")).toContain("HANDOFF");
  });

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

describe("validate converted template references", () => {
  test("accepts eta refs and rejects missing, mismatched, and half-converted files", () => {
    const dir = tmp("validate");
    mkdirSync(join(dir, "playbooks"), { recursive: true });
    const site = (ref: string, engine: string) =>
      `- hosts: web\n  tasks:\n    - name: t\n      copy:\n        dest: /etc/x\n        content:\n          template_file: ${ref}\n          engine: ${engine}\n`;
    writeFileSync(join(dir, "playbooks", "app.eta"), "Hello <%= name %>");
    writeFileSync(join(dir, "playbooks", "site.yml"), site("app.eta", "eta"));
    expect(validateConvertedTree(dir).every((entry) => entry.ok)).toBe(true);

    writeFileSync(join(dir, "playbooks", "site.yml"), site("missing.eta", "eta"));
    expect(validateConvertedTree(dir).some((entry) => !entry.ok && entry.error?.includes("does not resolve"))).toBe(true);

    writeFileSync(join(dir, "playbooks", "app.j2"), "x");
    writeFileSync(join(dir, "playbooks", "site.yml"), site("app.j2", "eta"));
    expect(validateConvertedTree(dir).some((entry) => !entry.ok && entry.error?.includes("engine eta"))).toBe(true);

    writeFileSync(join(dir, "playbooks", "app.eta"), "x");
    writeFileSync(join(dir, "playbooks", "site.yml"), site("app.eta", "eta"));
    expect(validateConvertedTree(dir).some((entry) => !entry.ok && entry.error?.includes("half-converted"))).toBe(true);
  });
});
