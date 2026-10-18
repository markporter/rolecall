import { describe, it, expect } from "bun:test";
import {
  registerFactPlugin,
  getRegisteredFactPlugins,
  getDeclaredFactNames,
} from "../src/facts/engine";
import { lintTemplateRefs } from "../src/config/loader";
import type { VarManifestEntry } from "../src/config/var-manifest/types";
import type { NormalizedPlaybook } from "../src/config/schema";

function factDecl(name: string): VarManifestEntry {
  return { name, kind: "fact", source: "observed", type: "string" };
}

function playbook(varManifests: unknown[], whenFact: string): NormalizedPlaybook {
  return {
    name: "pb",
    hosts: "all",
    var_strict: true,
    varManifests: varManifests as NormalizedPlaybook["varManifests"],
    tasks: [
      {
        name: "t",
        module: "debug",
        args: {},
        notify: [],
        when: { $eq: [{ $var: `facts.${whenFact}` }, "x"] },
      },
    ],
  } as NormalizedPlaybook;
}

describe("fact plugin registry + var_strict bridge", () => {
  it("registerFactPlugin records declares and gatherers", () => {
    const name = `plug-${Math.random().toString(36).slice(2)}`;
    registerFactPlugin({
      name,
      gatherers: [
        {
          name: "noop",
          provides: [],
          connectionKinds: ["ssh"],
          async gather() {
            return {};
          },
        },
      ],
      declares: [factDecl("plug_fact_a")],
    });
    expect(getRegisteredFactPlugins().some((p) => p.name === name)).toBe(true);
    expect(getDeclaredFactNames().has("plug_fact_a")).toBe(true);
  });

  it("lintTemplateRefs accepts $var refs to plugin-declared facts (var_strict on)", () => {
    const f = `bridge_fact_${Math.random().toString(36).slice(2)}`;
    registerFactPlugin({ name: `bp-${f}`, gatherers: [], declares: [factDecl(f)] });
    // A var manifest entry turns var_strict on; the $var ref resolves via the plugin declaration.
    const pb = playbook([{ name: "v", kind: "var", source: "declared", type: "string" }], f);
    expect(lintTemplateRefs(pb)).toHaveLength(0);
  });

  it("lintTemplateRefs rejects $var refs to undeclared facts", () => {
    const pb = playbook(
      [{ name: "v", kind: "var", source: "declared", type: "string" }],
      "no_such_fact_zzz",
    );
    const problems = lintTemplateRefs(pb);
    expect(problems.some((p) => p.kind === "undeclared-fact")).toBe(true);
  });
});
