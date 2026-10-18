// Phase 3: $var operator resolution + var_strict lint enforcement.
import { describe, expect, it } from "bun:test";

import { resolveNode } from "../src/templating/refs";
import { lintTemplateRefs } from "../src/config/loader";
import type { NormalizedPlaybook, VarManifestEntry } from "../src/config/schema";

const scope = {
  vars: { a: 1 },
  facts: { os: "Debian" },
  host: {},
  item: undefined,
  index: 0,
};

const declared = (over: Partial<VarManifestEntry> & Pick<VarManifestEntry, "name" | "kind">): VarManifestEntry => ({
  source: "declared",
  type: "string",
  ...over,
}) as VarManifestEntry;

const basePlay = (over: Partial<NormalizedPlaybook>): NormalizedPlaybook => ({
  hosts: ["all"],
  tasks: [{ name: "t", module: "debug", notify: [], args: { msg: { $var: "vars.foo" } } }],
  vars: {},
  ...over,
});

describe("$var operator (Phase 3)", () => {
  it("resolves a bare fact name from the facts namespace", () => {
    expect(resolveNode({ $var: "facts.os" }, scope)).toBe("Debian");
  });

  it("resolves a facts.-prefixed name without double-namespacing", () => {
    expect(resolveNode({ $var: "facts.os" }, scope)).toBe("Debian");
  });

  it("$var still reads the vars namespace", () => {
    expect(resolveNode({ $var: "vars.a" }, scope)).toBe(1);
  });
});

describe("var_strict lint enforcement (Phase 3)", () => {
  it("passes when the referenced var is declared", () => {
    const pb = basePlay({ varManifests: [declared({ name: "foo", kind: "var" })] });
    expect(lintTemplateRefs(pb)).toHaveLength(0);
  });

  it("flags an undeclared var as a hard problem", () => {
    const pb = basePlay({ varManifests: [declared({ name: "other", kind: "var" })] });
    const problems = lintTemplateRefs(pb);
    expect(problems.some((p) => p.kind === "undeclared-var")).toBe(true);
  });

  it("does not enforce when no manifest registry exists (gated)", () => {
    const pb = basePlay({ varManifests: undefined, tasks: [{ name: "t", module: "debug", notify: [], args: { msg: { $var: "vars.unknown" } } }] });
    const problems = lintTemplateRefs(pb);
    expect(problems.some((p) => p.kind === "undeclared-var")).toBe(false);
  });

  it("passes a declared fact and flags an undeclared one", () => {
    const ok = basePlay({
      varManifests: [declared({ name: "os", kind: "fact", source: "observed" })],
      tasks: [{ name: "t", module: "debug", notify: [], args: { msg: { $var: "facts.os" } } }],
    });
    expect(lintTemplateRefs(ok).some((p) => p.kind === "undeclared-fact")).toBe(false);

    const bad = basePlay({
      varManifests: [declared({ name: "x", kind: "var" })],
      tasks: [{ name: "t", module: "debug", notify: [], args: { msg: { $var: "facts.os" } } }],
    });
    expect(lintTemplateRefs(bad).some((p) => p.kind === "undeclared-fact")).toBe(true);
  });
});
