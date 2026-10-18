import { describe, it, expect } from "bun:test";
import { registerModule, getModule, listModules } from "../src/executor/module";
import {
  getRegisteredFactPlugins,
  getDeclaredFactNames,
} from "../src/facts/engine";
import type { Module } from "../src/executor/module";
import type { VarManifestEntry } from "../src/config/var-manifest/types";

describe("module-owned facts", () => {
  it("registerModule auto-registers a module's facts as a fact plugin", () => {
    const suffix = Math.random().toString(36).slice(2);
    const factName = `mod_fact_${suffix}`;
    const mod: Module = {
      name: `modfacts_${suffix}`,
      async run() {
        return { changed: false };
      },
      facts: [factDecl(factName)],
      factGatherer: {
        name: `mod-g-${suffix}`,
        provides: [factName],
        connectionKinds: ["ssh"],
        async gather() {
          return { [factName]: "ok" };
        },
      },
    };
    registerModule(mod);

    // Module is registered as a module.
    expect(getModule(mod.name)).toBeDefined();
    expect(listModules()).toContain(mod.name);
    // Its facts are declared (validate under var_strict).
    expect(getDeclaredFactNames().has(factName)).toBe(true);
    // Its fact provider is registered as a plugin.
    expect(getRegisteredFactPlugins().some((p) => p.name === `module:${mod.name}`)).toBe(true);
  });

  it("registerModule without facts does not register a fact plugin", () => {
    const name = `plain_${Math.random().toString(36).slice(2)}`;
    registerModule({
      name,
      async run() {
        return { changed: false };
      },
    });
    expect(getModule(name)).toBeDefined();
    expect(getRegisteredFactPlugins().some((p) => p.name === `module:${name}`)).toBe(false);
  });
});

function factDecl(name: string): VarManifestEntry {
  return { name, kind: "fact", source: "observed", type: "string" };
}
